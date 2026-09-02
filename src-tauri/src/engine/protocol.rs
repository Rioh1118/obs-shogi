use std::collections::VecDeque;
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::engine::{types::*, utils::cmd_summary};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, watch, Mutex, RwLock};
use usi::{EngineCommand, GuiCommand, IdParams, OptionParams, UsiEngineHandler};

const LOGT: &str = "obs_shogi::engine::protocol";

/// プロセスを落とした後に送ろうとしたときの文言
const GONE: &str = "engine process has been shut down";
/// USI プロトコル処理層
pub struct UsiProtocol {
    /// `Option` なのは、落とした後に **`Drop` を走らせない**ため。
    /// `UsiEngineHandler::Drop` は `kill().unwrap()` を呼ぶ（`usi` crate）。
    handler: Arc<Mutex<Option<UsiEngineHandler>>>,
    state: Arc<RwLock<ProtocolState>>,
    listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,
    listen_active: Arc<Mutex<bool>>,

    /// `isready` に対してエンジンがどう応じたか。
    ///
    /// **3値であることが要る。** `bool` だと「まだ返っていない」と
    /// 「もう返らない（プロセスが終わった）」が同じ値になり、`ensure_ready` が
    /// 上限まで待たされる。評価関数を読めずに即死するエンジンで
    /// `start_game` が2分返らなかった。
    ///
    /// watch なのは、**待つ側がポーリングしないで済む**ため。
    ready: Arc<watch::Sender<ReadyState>>,

    runtime_handle: tokio::runtime::Handle,
    init_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    init_cancel: Arc<Mutex<Option<CancellationToken>>>,
    generation: Arc<tokio::sync::RwLock<u64>>,
    pending_after_ready: Arc<Mutex<HashMap<u64, VecDeque<GuiCommand>>>>,
}

impl Clone for UsiProtocol {
    fn clone(&self) -> Self {
        Self {
            handler: Arc::clone(&self.handler),
            state: Arc::clone(&self.state),
            listeners: Arc::clone(&self.listeners),
            listen_active: Arc::clone(&self.listen_active),
            ready: Arc::clone(&self.ready),
            runtime_handle: self.runtime_handle.clone(),
            init_task: Arc::clone(&self.init_task),
            init_cancel: Arc::clone(&self.init_cancel),
            generation: Arc::clone(&self.generation),
            pending_after_ready: Arc::clone(&self.pending_after_ready),
        }
    }
}

#[derive(Debug, Clone)]
struct ProtocolState {
    engine_info: Option<EngineInfo>,
    last_command: Option<String>,
}

/// `isready` に対する応答の状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadyState {
    /// `isready` を送ったが、まだ `readyok` が返っていない
    Waiting,
    Ready,
    /// エンジンの出力が終わった。**もう `readyok` は返らない**
    Closed,
}

/// 読み取りを終わらせる合図。`usi` crate の `listen` へ返すためだけの型。
///
/// `listen` のループは、hook が `Err` を返すか、**読み取り自体が `Err` になった**
/// ときに終わる（`usi::UsiEngineHandler::listen`）。後者では hook が呼ばれない。
/// EOF だけは `Ok(response: None)` で来るので、hook がこれを返さないと終わらない。
#[derive(Debug)]
struct StopListening;

impl std::fmt::Display for StopListening {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "stop listening")
    }
}

impl std::error::Error for StopListening {}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn requires_ready(cmd: &GuiCommand) -> bool {
    matches!(
        cmd,
        GuiCommand::UsiNewGame | GuiCommand::Go(_) | GuiCommand::Position(_)
    )
}

impl UsiProtocol {
    pub fn new(handler: UsiEngineHandler) -> Self {
        Self {
            handler: Arc::new(Mutex::new(Some(handler))),
            state: Arc::new(RwLock::new(ProtocolState {
                engine_info: None,
                last_command: None,
            })),
            listeners: Arc::new(RwLock::new(HashMap::new())),
            listen_active: Arc::new(Mutex::new(false)),
            ready: Arc::new(watch::channel(ReadyState::Waiting).0),
            runtime_handle: tokio::runtime::Handle::current(),
            init_task: Arc::new(Mutex::new(None)),
            init_cancel: Arc::new(Mutex::new(None)),
            generation: Arc::new(tokio::sync::RwLock::new(0)),
            pending_after_ready: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// リスナー登録
    pub async fn register_listener(
        &self,
        name: String,
        sender: mpsc::UnboundedSender<EngineCommand>,
    ) -> Result<(), EngineError> {
        // リスナー追加
        self.listeners.write().await.insert(name.clone(), sender);

        // await をまたがないように「必要かどうか」だけ決める
        let need_start = {
            let mut g = self.listen_active.lock().await;
            if *g {
                false
            } else {
                *g = true;
                true
            }
        };

        if need_start {
            if let Err(e) = self.start_listening().await {
                // start_listening が失敗したらフラグを戻す
                let mut g = self.listen_active.lock().await;
                *g = false;
                return Err(e);
            }
        }

        Ok(())
    }

    /// リスナー削除
    pub async fn remove_listener(&self, name: &str) {
        self.listeners.write().await.remove(name);
    }

    /// リスニング開始(内部用)
    async fn start_listening(&self) -> Result<(), EngineError> {
        log::debug!(target: LOGT, "start_listening: begin");

        // 読み取りスレッドと配布の間をチャンネル1本で繋ぐ。
        //
        // 行ごとに `spawn` して配ると、**どのタスクが先に `send` するかが
        // ランタイム任せ**になる。`id name` と `usiok` が入れ替わると
        // `collect_engine_info` が `usiok` で抜けて名前が空になり、
        // エンジンの起動が偶発的に失敗する。
        //
        // 読み取り側は `send` するだけで、`unbounded` なので詰まらない。
        // ロックを待つのは配る側の1本に閉じる。
        let (line_tx, mut line_rx) = mpsc::unbounded_channel::<EngineCommand>();
        let listeners = Arc::clone(&self.listeners);
        let ready = Arc::clone(&self.ready);
        self.runtime_handle.spawn(async move {
            while let Some(cmd) = line_rx.recv().await {
                Self::broadcast_to_listeners(Arc::clone(&listeners), cmd).await;
            }

            // 読み取りが終わった。**溜まっていた行を配り切ってから**
            // 「もう来ない」を届ける。落とさないと `raw_rx.recv()` が永久に
            // 返らず、対局は手番のまま無音で止まる。
            //
            // **ここが唯一の置き場。** 読み取りの終わり方は1つではない。
            // EOF は下の hook が `Err` を返して終わらせるが、`usi` crate は
            // 読み取り自体の `Err`（非 UTF-8 の行、数値のパース失敗）では
            // **hook を呼ばずに**スレッドを抜ける。どの終わり方でも `line_tx` は
            // 落ちるので、この1箇所で全部を拾える。
            //
            // hook の中で落とすと、まだ配っていない行を捨てることになる。
            // `bestmove` を書いた直後に終了するエンジンでは、その手が
            // 誰にも届かないまま「応答しない」と判定される。
            listeners.write().await.clear();

            // `readyok` を待っている側にも届ける。listeners を落とすだけでは
            // `ensure_ready` は watch を見ているので気付かず、上限まで待つ
            let _ = ready.send(ReadyState::Closed);

            log::warn!(target: LOGT, "listen: engine output ended");
        });

        let mut handler_guard = self.handler.lock().await;
        let Some(handler) = handler_guard.as_mut() else {
            return Err(EngineError::NotInitialized(GONE.to_string()));
        };
        let result = handler.listen(move |output| -> Result<(), StopListening> {
            let Some(cmd) = output.response() else {
                // `response` が `None` になるのは**出力が閉じたときだけ**。
                // `usi` crate はそれを `Err` ではなく `Ok(response: None)` で返すので、
                // ここで `Err` を返さないと EOF を延々読む busy loop になる。
                //
                // 待っている側への通知はここではしない（上の転送タスクが行う）
                return Err(StopListening);
            };

            if line_tx.send(cmd.clone()).is_err() {
                // 配る側が落ちている。読み続けても届け先が無い
                return Err(StopListening);
            }
            Ok(())
        });

        drop(handler_guard);

        result.map_err(|e| {
            if e.to_string().contains("already started listening") {
                log::debug!(target: LOGT, "start_listening: already listening");
                EngineError::AlreadyListening(e.to_string())
            } else {
                log::error!(target: LOGT, "start_listening: failed: {}", e);
                EngineError::CommunicationFailed(e.to_string())
            }
        })
    }

    /// リスナーへのブロードキャスト処理を分離
    async fn broadcast_to_listeners(
        listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,
        cmd: EngineCommand,
    ) {
        // 失敗したリスナーを記録（削除用）
        let mut failed_listeners = Vec::new();

        // リスナーのスナップショットを取得（長時間ロックしない）
        let listeners_snapshot = {
            let guard = listeners.read().await;
            guard.clone()
        };

        // 各リスナーに配信
        for (name, sender) in listeners_snapshot.iter() {
            if sender.send(cmd.clone()).is_err() {
                // 送信失敗 = チャンネルクローズ済み
                failed_listeners.push(name.clone());
            }
        }

        // 失敗したリスナーを削除（自動クリーンアップ）
        if !failed_listeners.is_empty() {
            let mut guard = listeners.write().await;
            for name in failed_listeners {
                guard.remove(&name);
            }
        }
    }

    /// コマンド送信（スレッドセーフ）
    pub async fn send_command(&self, command: &GuiCommand) -> Result<(), EngineError> {
        // コマンド履歴更新
        self.state.write().await.last_command = Some(cmd_summary(command));

        if matches!(command, GuiCommand::IsReady) {
            self.start_ready_watch_and_send().await?;
            return Ok(());
        }

        // ready 前で ready 必須のコマンドなら enqueue
        let is_ready = self.is_ready();
        if !is_ready && requires_ready(command) {
            let gen = *self.generation.read().await;
            let mut map = self.pending_after_ready.lock().await;
            let q = map.entry(gen).or_default();
            q.push_back(command.clone());
            log::debug!(
                target: LOGT,
                "send_command: queued cmd={} gen={} qlen={}",
                cmd_summary(command),
                gen,
                q.len()
            );
            return Ok(());
        }

        // 通常送信
        let mut guard = self.handler.lock().await;
        let Some(handler) = guard.as_mut() else {
            return Err(EngineError::NotInitialized(GONE.to_string()));
        };
        handler
            .send_command(command)
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;

        Ok(())
    }

    async fn start_ready_watch_and_send(&self) -> Result<(), EngineError> {
        self.abort_init().await;

        let gen = {
            let mut g = self.generation.write().await;
            *g += 1;
            *g
        };

        let _ = self.ready.send(ReadyState::Waiting);

        let cancel = CancellationToken::new();
        *self.init_cancel.lock().await = Some(cancel.clone());

        let (tx, mut rx) = mpsc::unbounded_channel();
        let listener_name = format!("ready_wait_{}_{}", gen, now_nanos());
        self.register_listener(listener_name.clone(), tx).await?;

        {
            let mut guard = self.handler.lock().await;
            let Some(handler) = guard.as_mut() else {
                return Err(EngineError::NotInitialized(GONE.to_string()));
            };
            handler
                .send_command(&GuiCommand::IsReady)
                .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;
        }

        // 非ブロッキングに readyok 待ち
        let protocol = Arc::new(self.clone());
        let handle = tokio::spawn(async move {
            let mut ready = false;

            loop {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        // キャンセルされた
                        break;
                    }
                    msg = rx.recv() => {
                        match msg {
                            Some(EngineCommand::ReadyOk) => { ready = true; break; }
                            Some(_) => {}
                            None => { break; }
                        }
                    }
                }
            }

            protocol.remove_listener(&listener_name).await;

            if *protocol.generation.read().await != gen {
                return;
            }

            if ready {
                let _ = protocol.ready.send(ReadyState::Ready);
                log::info!(target: LOGT, "ready: ok gen={}", gen);

                let mut map = protocol.pending_after_ready.lock().await;
                let mut q = map.remove(&gen).unwrap_or_default();
                drop(map);

                while let Some(cmd) = q.pop_front() {
                    let mut guard = protocol.handler.lock().await;
                    let Some(h) = guard.as_mut() else {
                        break;
                    };
                    if let Err(e) = h.send_command(&cmd) {
                        log::warn!(
                            target: LOGT,
                            "ready: flush failed cmd={} err={}",
                            cmd_summary(&cmd),
                            e
                        );
                        break;
                    }
                }
            } else {
                log::warn!(target: LOGT, "ready: ended without readyok gen={}", gen);
                let mut map = protocol.pending_after_ready.lock().await;
                map.remove(&gen);
            }
        });

        *self.init_task.lock().await = Some(handle);
        Ok(())
    }

    /// `usi` を送り `usiok` までを読み取る。2回目以降はキャッシュを返す。
    ///
    /// `usiok` を返さないエンジンでここが返らないと、呼び出し元の起動処理ごと
    /// 止まったまま利用者に何も出ない。`timeout` はそのための打ち切り。
    pub async fn get_engine_info(&self, timeout: Duration) -> Result<EngineInfo, EngineError> {
        {
            let state = self.state.read().await;
            if let Some(info) = &state.engine_info {
                return Ok(info.clone());
            }
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let listener_name = format!("info_collection_{}", now_nanos());

        self.register_listener(listener_name.clone(), tx).await?;
        let sent = self.send_command(&GuiCommand::Usi).await;
        let collected = match sent {
            Ok(()) => tokio::time::timeout(timeout, Self::collect_engine_info(rx))
                .await
                .unwrap_or(Err(EngineError::Timeout(
                    "engine did not return usiok in time".to_string(),
                ))),
            Err(e) => Err(e),
        };

        // 打ち切ったときもリスナーを外す。残すと、以降の `info` が
        // 誰も読まないチャンネルへ配られ続ける。
        self.remove_listener(&listener_name).await;

        let engine_info = collected?;
        self.state.write().await.engine_info = Some(engine_info.clone());

        Ok(engine_info)
    }

    async fn collect_engine_info(
        mut rx: mpsc::UnboundedReceiver<EngineCommand>,
    ) -> Result<EngineInfo, EngineError> {
        let mut name = String::new();
        let mut author = String::new();
        let mut options = Vec::new();
        let mut saw_usiok = false;

        while let Some(cmd) = rx.recv().await {
            match cmd {
                EngineCommand::Id(IdParams::Name(n)) => name = n,
                EngineCommand::Id(IdParams::Author(a)) => author = a,
                EngineCommand::Option(option_params) => {
                    options.push(convert_option_params(&option_params));
                }
                EngineCommand::UsiOk => {
                    saw_usiok = true;
                    break;
                }
                _ => {} // 他のコマンドは無視（高頻度でくる可能性）
            }
        }

        if name.is_empty() {
            // 出力が終わったのか、`usiok` までに `id name` が無かったのかで
            // 呼び出し側の対処が違う。潰さない
            return Err(EngineError::CommunicationFailed(if saw_usiok {
                "engine did not send `id name` before `usiok`".to_string()
            } else {
                "engine output ended before `usiok`".to_string()
            }));
        }

        Ok(EngineInfo {
            name,
            author,
            options,
        })
    }

    /// `readyok` を受け取り済みか
    pub fn is_ready(&self) -> bool {
        let state: ReadyState = *self.ready.borrow();
        state == ReadyState::Ready
    }

    /// `isready` を送り、`readyok` が返るまで待つ。
    ///
    /// 既に ready なら何も送らない。対局の開始前と、局面を送る前にこれを通す。
    /// 待たずに `position` / `go` を送っても `send_command` が ready まで
    /// 積んでくれるが、**積まれたまま返ってこないことを呼び出し側が知れない。**
    pub async fn ensure_ready(&self, timeout: Duration) -> Result<(), EngineError> {
        if self.is_ready() {
            return Ok(());
        }

        self.send_command(&GuiCommand::IsReady).await?;

        let mut rx = self.ready.subscribe();
        let settled =
            tokio::time::timeout(timeout, rx.wait_for(|state| *state != ReadyState::Waiting))
                .await
                .map_err(|_| {
                    EngineError::Timeout("engine did not return readyok in time".to_string())
                })?
                .map_err(|_| {
                    EngineError::CommunicationFailed("ready channel closed".to_string())
                })?;

        // **上限まで待たずに返る。** 出力が終わっているなら `readyok` は来ない
        if *settled == ReadyState::Closed {
            return Err(EngineError::CommunicationFailed(
                "engine exited before it became ready".to_string(),
            ));
        }

        Ok(())
    }

    /// 現在のリスナー数取得（デバッグ用）
    pub async fn listener_count(&self) -> usize {
        self.listeners.read().await.len()
    }

    async fn abort_init(&self) {
        // cancel token
        if let Some(tok) = self.init_cancel.lock().await.take() {
            tok.cancel();
        }
        // join handle
        if let Some(h) = self.init_task.lock().await.take() {
            h.abort();
        }

        self.pending_after_ready.lock().await.clear();
    }

    pub async fn quit(&self) {
        log::debug!(target: LOGT, "quit: sending");
        let _ = self.send_command(&GuiCommand::Quit).await;
    }

    /// プロセスを落とす。2度目以降は何もしない。
    ///
    /// **落とした handler を drop させない。** `usi` crate の
    /// `UsiEngineHandler::Drop` は `kill().unwrap()` を呼び、`kill` は先に
    /// `quit` を書く（`process/engine.rs:73-77, 176-180`）。既に死んだプロセスへの
    /// 書き込みは EPIPE で失敗するので、**2度目の `kill` は必ずパニックする**。
    ///
    /// `forget` で漏れるのはパイプの fd。子プロセスの回収はどちらにせよ
    /// 起きない（Rust の `Child::drop` は `wait` しない）。→ #353
    pub async fn kill_engine(&self) {
        log::info!(target: LOGT, "kill_engine: start");
        self.abort_init().await;

        let taken = self.handler.lock().await.take();
        let Some(mut handler) = taken else {
            log::debug!(target: LOGT, "kill_engine: already gone");
            return;
        };

        // 戻り値に用は無い。目的は「死んでいること」で、
        // 既に死んでいれば `quit` の書き込みが失敗するだけ
        let _ = handler.kill();
        std::mem::forget(handler);

        log::info!(target: LOGT, "kill_engine: done");
    }
}

// ヘルパー関数（高速化のためインライン化）
#[inline]
fn convert_option_params(params: &OptionParams) -> EngineOption {
    use usi::OptionKind;

    let option_type = match &params.value {
        OptionKind::Check { default } => EngineOptionType::Check { default: *default },
        OptionKind::Spin { default, min, max } => EngineOptionType::Spin {
            default: *default,
            min: *min,
            max: *max,
        },
        OptionKind::Combo { default, vars } => EngineOptionType::Combo {
            default: default.clone(),
            vars: vars.clone(),
        },
        OptionKind::Button { default } => EngineOptionType::Button {
            default: default.clone(),
        },
        OptionKind::String { default } => EngineOptionType::String {
            default: default.clone(),
        },
        OptionKind::Filename { default } => EngineOptionType::Filename {
            default: default.clone(),
        },
    };

    let default_value = match &params.value {
        OptionKind::Check { default } => default.map(|b| b.to_string()),
        OptionKind::Spin { default, .. } => default.map(|i| i.to_string()),
        OptionKind::Combo { default, .. } => default.clone(),
        OptionKind::Button { default } => default.clone(),
        OptionKind::String { default } => default.clone(),
        OptionKind::Filename { default } => default.clone(),
    };

    EngineOption {
        name: params.name.clone(),
        option_type,
        default_value,
        current_value: None,
    }
}
