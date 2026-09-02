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
/// 出力が終わったプロセスへ送ろうとしたときの文言
const CLOSED: &str = "engine output has ended; the process cannot be reached";
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
    /// 「もう返らない（プロセスが終わった）」が同じ値になる。
    /// 前者は待てば来るが、後者は `READY_TIMEOUT` を使い切るまで待つだけで、
    /// その間 `start_game` は返らない（評価関数を読めずに即死するエンジンで踏む）。
    /// 書き込み側の分岐も3値を見る（`dispatch_for`）。
    ///
    /// watch なのは、**待つ側がポーリングしないで済む**ため。
    ready: Arc<watch::Sender<ReadyState>>,

    runtime_handle: tokio::runtime::Handle,
    init_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    init_cancel: Arc<Mutex<Option<CancellationToken>>>,
    pending: Arc<Mutex<Pending>>,
}

/// `readyok` を待つ間に積んだコマンドと、その世代。
///
/// **世代とキューを同じロックの下に置く。** 別々に持つと、世代を読んでから
/// 積むまでの間に次の `isready` が挟まり、**消された直後の世代へ入れる**ことになる。
/// そこに入ったコマンドを掃く者はいないので、呼び出し側に `Ok` を返したまま消える。
///
/// 1つにまとめたので、積む側は世代を読む必要が無い。キューは常に現在の世代のもの。
struct Pending {
    generation: u64,
    queue: VecDeque<GuiCommand>,
}

/// 積み置きの上限。
///
/// `readyok` を返さないエンジンでは、`position` と `go` が来るたびに積み続ける。
/// 上限を超えたら断る側に倒す。**積んで `Ok` を返すより、断ったほうが呼び出し側が気付ける。**
/// 32 は「1局面ぶんの `position` + `go` が十数回入っても足りる」から。
/// 正常な流れでこの数に届くことはない
const PENDING_LIMIT: usize = 32;

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
            pending: Arc::clone(&self.pending),
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
    ///
    /// **ここから戻る道は無い。** `usi` crate の `listen` は reader を `take` するので
    /// 読み取りは1回きりで、二度と始まらない。復帰の手段はプロセスの再起動しかない。
    Closed,
}

/// `ready` の次の値を決める。**`Closed` は吸収状態。**
///
/// 書き込み側（`dispatch_for` の `Refuse`）と `register_listener` の拒否は、
/// どちらも `Closed` を見て断っている。戻す口があると、`isready` を1本送るだけで
/// 両方が同時に無効になり、`position` も `go` も `Queue` に落ちて `Ok` が返る。
/// 待っている側は永久に返らない。
fn next_ready_state(current: ReadyState, requested: ReadyState) -> ReadyState {
    match current {
        ReadyState::Closed => ReadyState::Closed,
        _ => requested,
    }
}

/// flush が途中で折れたときに、書けなかったぶんを残す。
///
/// `failed` を含めるのは、**書き込みに失敗したコマンドも届いていない**ため。
/// 残りだけ挙げると、折れた1件が届いたように読める
fn report_dropped(failed: &GuiCommand, rest: &VecDeque<GuiCommand>) {
    for cmd in std::iter::once(failed).chain(rest.iter()) {
        log::warn!(
            target: LOGT,
            "ready: dropping queued cmd={} (the flush could not continue)",
            cmd_summary(cmd)
        );
    }
}

/// エンジンへの書き込み。**専用スレッドへ出す。**
///
/// `usi` crate の書き込みは `ChildStdin` への `write_all` + `flush` で、
/// **同期のブロッキング呼び出し**（`usi-0.6.2/src/process/writer.rs`）。
/// これを async のタスクの中で直に呼ぶと、エンジンが stdin を読まなくなって
/// パイプが埋まったときに `poll` が返らず、次の2つが同時に起きる。
///
/// 1. ワーカースレッドが1本、そのタスクに固定される
/// 2. **そのタスクを包んだ `tokio::time::timeout` が発火できない。**
///    タイマーが満了しても `Timeout` を `poll` する者が居ないため
///
/// 2 のせいで、上限を置いたつもりの `close_game` が返らなくなる。
/// `spawn_blocking` に出せば詰まるのは専用スレッドだけになり、
/// `JoinHandle` を待つ側は普通に打ち切れる。
async fn write_command(
    handler: Arc<Mutex<Option<UsiEngineHandler>>>,
    command: GuiCommand,
) -> Result<(), EngineError> {
    tokio::task::spawn_blocking(move || {
        let mut guard = handler.blocking_lock();
        let Some(h) = guard.as_mut() else {
            return Err(EngineError::NotInitialized(GONE.to_string()));
        };
        h.send_command(&command)
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))
    })
    .await
    .map_err(|e| EngineError::CommunicationFailed(format!("write task failed: {e}")))?
}

/// `ready` への書き込みはここ1本を通す。返すのは実際に落ち着いた値。
fn set_ready_state(ready: &watch::Sender<ReadyState>, requested: ReadyState) -> ReadyState {
    let mut settled = requested;
    ready.send_if_modified(|current| {
        settled = next_ready_state(*current, requested);
        if settled == *current {
            false
        } else {
            *current = settled;
            true
        }
    });
    settled
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

fn requires_ready(cmd: &GuiCommand) -> bool {
    matches!(
        cmd,
        GuiCommand::UsiNewGame | GuiCommand::Go(_) | GuiCommand::Position(_)
    )
}

/// 送ろうとしているコマンドをどう扱うか。
#[derive(Debug, PartialEq, Eq)]
enum Dispatch {
    /// そのまま書く
    Send,
    /// `readyok` まで積む
    Queue,
    /// 断る。出力が終わっているので、書いても待っても何も返らない
    Refuse,
}

/// `ReadyState` とコマンドから、送る／積む／断るを決める。
///
/// **`Closed` を `Waiting` と同じ扱いにしない。** 積み置きは
/// 「まだ `readyok` が来ていない」ための仕組みで、「**もう来ない**」ときの
/// 置き場ではない。積むと呼び出し側へ `Ok` が返り、`bestmove` を待つ側は
/// 永久に返らないまま対局が無音で止まる。
///
/// 純関数にしてあるのは、`UsiProtocol` が実プロセスを要るので
/// この写像だけを固定したいため。
fn dispatch_for(state: ReadyState, cmd: &GuiCommand) -> Dispatch {
    match state {
        ReadyState::Closed => Dispatch::Refuse,
        ReadyState::Ready => Dispatch::Send,
        ReadyState::Waiting if requires_ready(cmd) => Dispatch::Queue,
        ReadyState::Waiting => Dispatch::Send,
    }
}

/// 積み置きから `go` を落とす。落とした数を返す。
///
/// **`stop` は積まれないのに `go` は積まれる**ので、`readyok` を待っている間は
/// 順序が入れ替わる。そのまま書くと `stop` が先にエンジンへ届き、まだ探索して
/// いないので何も起きず、後から flush された `go` で**利用者が止めたはずの探索が
/// 始まる**。画面は「停止」のままエンジンだけが回り続ける。
///
/// `position` は落とさない。局面を送っただけでは何も起きないうえ、
/// 次の `go` の前提になる。
fn cancel_queued_go(queue: &mut VecDeque<GuiCommand>) -> usize {
    let before = queue.len();
    queue.retain(|cmd| !matches!(cmd, GuiCommand::Go(_)));
    before - queue.len()
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
            pending: Arc::new(Mutex::new(Pending {
                generation: 0,
                queue: VecDeque::new(),
            })),
        }
    }

    /// リスナー登録
    pub async fn register_listener(
        &self,
        name: String,
        sender: mpsc::UnboundedSender<EngineCommand>,
    ) -> Result<(), EngineError> {
        // 出力が終わったプロセスには登録させない。
        //
        // `listen_active` は `true` のまま戻らず、読み取りは二度と始まらない
        // （`usi` crate の `listen` は reader を `take` するので1回きり）。
        // 入れても誰も配らないので、`raw_rx.recv()` が永久に返らない待ちができる
        let state: ReadyState = *self.ready.borrow();
        if state == ReadyState::Closed {
            return Err(EngineError::CommunicationFailed(CLOSED.to_string()));
        }

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
            // 読み取りの終わり方は1つではない。EOF は下の hook が `Err` を
            // 返して終わらせるが、`usi` crate は読み取り自体の `Err`
            // （非 UTF-8 の行、数値のパース失敗）では**hook を呼ばずに**
            // スレッドを抜ける。**どの終わり方でも `line_tx` は落ちる**ので、
            // ここに置けば終わり方を数え上げずに済む。
            //
            // hook の中で落とすと、まだ配っていない行を捨てることになる。
            // `bestmove` を書いた直後に終了するエンジンでは、その手が
            // 誰にも届かないまま「応答しない」と判定される。
            listeners.write().await.clear();

            // `readyok` を待っている側にも届ける。listeners を落とすだけでは
            // `ensure_ready` は watch を見ているので気付かず、上限まで待つ
            set_ready_state(&ready, ReadyState::Closed);

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

        // **`IsReady` もここを通す。** 手前で分岐すると、`dispatch_for` が
        // `Closed` に対して返している `Refuse` を誰も聞かないことになる
        let state: ReadyState = *self.ready.borrow();
        match dispatch_for(state, command) {
            Dispatch::Refuse => {
                return Err(EngineError::CommunicationFailed(CLOSED.to_string()));
            }
            Dispatch::Send => {
                // `stop` だけは、書きに行く前に積み置きの `go` を取り消す。
                // 取り消さないと順序が入れ替わり、止めたはずの探索が後から始まる
                if matches!(command, GuiCommand::Stop) {
                    let cancelled = {
                        let mut pending = self.pending.lock().await;
                        cancel_queued_go(&mut pending.queue)
                    };
                    if cancelled > 0 {
                        log::info!(
                            target: LOGT,
                            "send_command: stop cancelled {cancelled} queued go"
                        );
                        // エンジンはまだ探索していない。`stop` を書く相手が居ない
                        return Ok(());
                    }
                }
            }
            Dispatch::Queue => {
                let mut pending = self.pending.lock().await;

                // **ロックを取った後に状態を読み直す。** 取るまでの間に
                // `readyok` が着地すると、flush は既にキューを空にして去っている。
                // 読み直さないと、**もう誰も掃かないキューへ積んで `Ok` を返す**
                // ことになる（`position` だけが消えて `go` が届く、が起きる）。
                match dispatch_for(*self.ready.borrow(), command) {
                    Dispatch::Refuse => {
                        return Err(EngineError::CommunicationFailed(CLOSED.to_string()));
                    }
                    // 間に合った。そのまま書きに行く
                    Dispatch::Send => {
                        drop(pending);
                    }
                    Dispatch::Queue => {
                        if pending.queue.len() >= PENDING_LIMIT {
                            log::warn!(
                                target: LOGT,
                                "send_command: pending queue is full cmd={} gen={}",
                                cmd_summary(command),
                                pending.generation
                            );
                            return Err(EngineError::CommunicationFailed(format!(
                                "the engine has not returned readyok; {PENDING_LIMIT} commands are already queued"
                            )));
                        }
                        pending.queue.push_back(command.clone());
                        log::debug!(
                            target: LOGT,
                            "send_command: queued cmd={} gen={} qlen={}",
                            cmd_summary(command),
                            pending.generation,
                            pending.queue.len()
                        );
                        return Ok(());
                    }
                }
            }
        }

        if matches!(command, GuiCommand::IsReady) {
            return self.start_ready_watch_and_send().await;
        }

        write_command(Arc::clone(&self.handler), command.clone()).await
    }

    async fn start_ready_watch_and_send(&self) -> Result<(), EngineError> {
        self.abort_init().await;

        let gen = self.begin_generation().await;

        // `send_command` も `dispatch_for` で断っているが、**判定をここにも置く。**
        // 呼び出し側の順序に依存させると、手前に分岐が1つ増えただけで穴が開く
        // （`IsReady` だけ `dispatch_for` を通らない時期があった）
        if set_ready_state(&self.ready, ReadyState::Waiting) == ReadyState::Closed {
            return Err(EngineError::CommunicationFailed(CLOSED.to_string()));
        }

        let cancel = CancellationToken::new();
        *self.init_cancel.lock().await = Some(cancel.clone());

        let (tx, mut rx) = mpsc::unbounded_channel();
        let listener_name = format!("ready_wait_{}_{}", gen, uuid::Uuid::new_v4());
        self.register_listener(listener_name.clone(), tx).await?;

        write_command(Arc::clone(&self.handler), GuiCommand::IsReady).await?;

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

            // **世代の確認と `Ready` の書き込みを同じロック区間に入れる。**
            // 確認だけして手放すと、その隙に次の `isready` が世代を上げて
            // `Waiting` に落とせる。`abort()` は次の await 点までしか効かないので、
            // 確認を通過済みのこのタスクは構わず `Ready` を書く。
            // 結果、`readyok` が返っていないエンジンに対して `ensure_ready` が
            // 即 `Ok` を返し、まだ評価関数を読んでいる相手へ `position` / `go` が流れる
            let mut pending = protocol.pending.lock().await;
            if pending.generation != gen {
                return;
            }

            if ready {
                set_ready_state(&protocol.ready, ReadyState::Ready);
                log::info!(target: LOGT, "ready: ok gen={}", gen);

                drop(pending);

                // **キューをローカルへ移さない。** 移すと、書いている途中に
                // `abort_init` が入ったときに `pending.queue` が空なので
                // `discard_pending` が何も見つけられず、まだ書いていないぶんが
                // 1行も残さずに消える（積んだ側には `Ok` が返っている）。
                // 1件ずつ取り出して、残りは常に `pending` の側に置いておく
                loop {
                    let next = {
                        let mut pending = protocol.pending.lock().await;
                        if pending.generation != gen {
                            // 次の `isready` が来た。残りは `begin_generation` が残す
                            break;
                        }
                        pending.queue.pop_front()
                    };
                    let Some(cmd) = next else { break };

                    if let Err(e) = write_command(Arc::clone(&protocol.handler), cmd.clone()).await
                    {
                        log::warn!(
                            target: LOGT,
                            "ready: flush failed cmd={} err={}",
                            cmd_summary(&cmd),
                            e
                        );
                        let rest = {
                            let mut pending = protocol.pending.lock().await;
                            std::mem::take(&mut pending.queue)
                        };
                        report_dropped(&cmd, &rest);
                        break;
                    }
                }
            } else {
                log::warn!(target: LOGT, "ready: ended without readyok gen={}", gen);
                let q = std::mem::take(&mut pending.queue);
                drop(pending);
                for cmd in &q {
                    log::warn!(
                        target: LOGT,
                        "ready: dropping queued cmd={} (readyok never came)",
                        cmd_summary(cmd)
                    );
                }
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
        let listener_name = format!("info_collection_{}", uuid::Uuid::new_v4());

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

        // **`subscribe` は送る前に取る。** 後に回すと、送ってから購読するまでの間に
        // 出力が終わった場合に `Closed` を見落として上限まで待つ
        let mut rx = self.ready.subscribe();
        self.send_command(&GuiCommand::IsReady).await?;

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

        self.discard_pending("the ready wait was aborted").await;
    }

    /// 世代を上げ、前の世代の積み置きを捨てる。**同じロックの中で行う。**
    ///
    /// 別々にすると、上げてから捨てるまでの間に積まれたぶんが、
    /// 新しい世代のキューに前の世代のコマンドとして残る
    async fn begin_generation(&self) -> u64 {
        let mut pending = self.pending.lock().await;
        pending.generation += 1;
        let gen = pending.generation;
        let dropped = std::mem::take(&mut pending.queue);
        drop(pending);

        for cmd in &dropped {
            log::warn!(
                target: LOGT,
                "ready: dropping queued cmd={} (a new isready started)",
                cmd_summary(cmd)
            );
        }
        gen
    }

    /// 積み置きを捨てる。**捨てるものがあったら必ず1行残す。**
    ///
    /// 積んだ時点で呼び出し側には `Ok` が返っているので、ここで黙ると
    /// 「送ったつもりのコマンドがどこにも書かれない」が痕跡なしに起きる
    async fn discard_pending(&self, why: &str) {
        let dropped = {
            let mut pending = self.pending.lock().await;
            std::mem::take(&mut pending.queue)
        };
        for cmd in &dropped {
            log::warn!(
                target: LOGT,
                "ready: dropping queued cmd={} ({why})",
                cmd_summary(cmd)
            );
        }
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

        // **落とす前に `Closed` を立てる。** 立てないと、`handler` を `take` した
        // 後も `ready` が `Waiting` のまま残り、死んだプロセス向けに
        // `position` / `go` が積める（`Ok` が返り、掃く者は永久に来ない）
        set_ready_state(&self.ready, ReadyState::Closed);

        self.abort_init().await;

        // `kill` も `quit` を書くので、書き込みと同じ理由で専用スレッドへ出す
        let handler = Arc::clone(&self.handler);
        let killed = tokio::task::spawn_blocking(move || {
            let taken = handler.blocking_lock().take();
            let Some(mut handler) = taken else {
                return false;
            };

            // 戻り値に用は無い。目的は「死んでいること」で、
            // 既に死んでいれば `quit` の書き込みが失敗するだけ
            let _ = handler.kill();
            std::mem::forget(handler);
            true
        })
        .await;

        match killed {
            Ok(true) => log::info!(target: LOGT, "kill_engine: done"),
            Ok(false) => log::debug!(target: LOGT, "kill_engine: already gone"),
            Err(e) => log::warn!(target: LOGT, "kill_engine: task failed: {e}"),
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// `ReadyState` にバリアントを足したら、書き込み側の分岐をここで数え直す。
    ///
    /// `IsReady` を含めているのは、`send_command` がこの写像を通さずに
    /// 分岐していた時期があるため。**通さない分岐があると、ここが緑でも現物は違う。**
    #[test]
    fn a_closed_engine_is_refused_instead_of_queued() {
        let go = GuiCommand::Go(usi::ThinkParams::new());
        let position = GuiCommand::Position("sfen".to_string());
        let stop = GuiCommand::Stop;
        let isready = GuiCommand::IsReady;

        // 出力が終わっている。**積むと呼び出し側に `Ok` が返り、待ち手が永久に返らない**
        for cmd in [&go, &position, &stop, &isready] {
            assert_eq!(
                dispatch_for(ReadyState::Closed, cmd),
                Dispatch::Refuse,
                "{cmd} を断っていない"
            );
        }

        // `readyok` 待ち。局面と思考だけ積む
        assert_eq!(dispatch_for(ReadyState::Waiting, &go), Dispatch::Queue);
        assert_eq!(
            dispatch_for(ReadyState::Waiting, &position),
            Dispatch::Queue
        );
        assert_eq!(dispatch_for(ReadyState::Waiting, &stop), Dispatch::Send);
        assert_eq!(dispatch_for(ReadyState::Waiting, &isready), Dispatch::Send);

        // ready。全部そのまま
        for cmd in [&go, &position, &stop, &isready] {
            assert_eq!(dispatch_for(ReadyState::Ready, cmd), Dispatch::Send);
        }
    }

    /// `Closed` から戻す口を作らないこと。
    ///
    /// 戻せると `dispatch_for` の `Refuse` も `register_listener` の拒否も、
    /// `isready` 1本で同時に無効になる。
    #[test]
    fn closed_absorbs_every_later_transition() {
        for requested in [ReadyState::Waiting, ReadyState::Ready, ReadyState::Closed] {
            assert_eq!(
                next_ready_state(ReadyState::Closed, requested),
                ReadyState::Closed,
                "Closed から {requested:?} へ戻している"
            );
        }

        // `Closed` 以外は要求どおりに動く
        for current in [ReadyState::Waiting, ReadyState::Ready] {
            for requested in [ReadyState::Waiting, ReadyState::Ready, ReadyState::Closed] {
                assert_eq!(next_ready_state(current, requested), requested);
            }
        }
    }

    /// `stop` が積み置きの `go` を取り消すこと。
    ///
    /// `stop` は積まれないのに `go` は積まれるので、`readyok` を待っている間は
    /// 順序が入れ替わる。取り消さないと、**利用者が止めた後に探索が始まる**
    #[test]
    fn a_stop_cancels_queued_go() {
        let mut queue = VecDeque::from(vec![
            GuiCommand::UsiNewGame,
            GuiCommand::Position("sfen".to_string()),
            GuiCommand::Go(usi::ThinkParams::new()),
        ]);

        assert_eq!(cancel_queued_go(&mut queue), 1);

        // `position` は残す。送っただけでは何も起きず、次の `go` の前提になる
        assert_eq!(queue.len(), 2);
        assert!(matches!(queue[0], GuiCommand::UsiNewGame));
        assert!(matches!(queue[1], GuiCommand::Position(_)));

        // 2度目は何も落とさない
        assert_eq!(cancel_queued_go(&mut queue), 0);
    }

    /// 落ち着いた値を返すこと。呼び出し側はこれを見て「戻せなかった」を知る
    #[test]
    fn set_ready_state_reports_what_it_settled_on() {
        let ready = watch::channel(ReadyState::Waiting).0;

        assert_eq!(
            set_ready_state(&ready, ReadyState::Ready),
            ReadyState::Ready
        );
        assert_eq!(
            set_ready_state(&ready, ReadyState::Closed),
            ReadyState::Closed
        );
        assert_eq!(
            set_ready_state(&ready, ReadyState::Waiting),
            ReadyState::Closed,
            "Closed の後に Waiting を通している"
        );
        assert_eq!(*ready.borrow(), ReadyState::Closed);
    }
}
