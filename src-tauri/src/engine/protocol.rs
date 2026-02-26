use std::collections::VecDeque;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::engine::{types::*, utils::cmd_summary};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use usi::{EngineCommand, Error as UsiError, GuiCommand, IdParams, OptionParams, UsiEngineHandler};

const LOGT: &str = "obs_shogi::engine::protocol";
/// USI プロトコル処理層
pub struct UsiProtocol {
    handler: Arc<Mutex<UsiEngineHandler>>,
    state: Arc<RwLock<ProtocolState>>,
    listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,
    listen_active: Arc<Mutex<bool>>,

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
    is_ready: bool,
    engine_info: Option<EngineInfo>,
    last_command: Option<String>,
}

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
            handler: Arc::new(Mutex::new(handler)),
            state: Arc::new(RwLock::new(ProtocolState {
                is_ready: false,
                engine_info: None,
                last_command: None,
            })),
            listeners: Arc::new(RwLock::new(HashMap::new())),
            listen_active: Arc::new(Mutex::new(false)),
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

        let listeners = Arc::clone(&self.listeners);
        let runtime_handler = self.runtime_handle.clone();

        let mut handler_guard = self.handler.lock().await;
        let result = handler_guard.listen(move |output| -> Result<(), UsiError> {
            //  ポイント：クロージャー内でクローンしてからtokio::spawnに渡す
            if let Some(cmd) = output.response() {
                let cmd_owned = cmd.clone(); // ここでクローン
                let listeners = Arc::clone(&listeners);

                runtime_handler.spawn(async move {
                    Self::broadcast_to_listeners(listeners, cmd_owned).await;
                });
            }
            // エラーが発生しても継続（Okを返す）
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
        let is_ready = self.state.read().await.is_ready;
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
        let mut handler = self.handler.lock().await;
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

        self.state.write().await.is_ready = false;

        let cancel = CancellationToken::new();
        *self.init_cancel.lock().await = Some(cancel.clone());

        let (tx, mut rx) = mpsc::unbounded_channel();
        let listener_name = format!("ready_wait_{}_{}", gen, now_nanos());
        self.register_listener(listener_name.clone(), tx).await?;

        {
            let mut handler = self.handler.lock().await;
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
                protocol.state.write().await.is_ready = true;
                log::info!(target: LOGT, "ready: ok gen={}", gen);

                let mut map = protocol.pending_after_ready.lock().await;
                let mut q = map.remove(&gen).unwrap_or_default();
                drop(map);

                while let Some(cmd) = q.pop_front() {
                    let mut h = protocol.handler.lock().await;
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

    /// エンジン情報取得（タイムアウト付き）
    pub async fn get_engine_info(&self) -> Result<EngineInfo, EngineError> {
        // キャッシュチェック
        {
            let state = self.state.read().await;
            if let Some(info) = &state.engine_info {
                return Ok(info.clone());
            }
        }

        // 情報収集用チャンネル（バッファ付きで高頻度対応）
        let (tx, mut rx) = mpsc::unbounded_channel();

        // 一時的なリスナー登録
        let listener_name = format!(
            "info_collection_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        self.register_listener(listener_name.clone(), tx).await?;
        // USIコマンド送信
        self.send_command(&GuiCommand::Usi).await?;

        // 情報収集（高頻度対応）
        let mut name = String::new();
        let mut author = String::new();
        let mut options = Vec::new();

        while let Some(cmd) = rx.recv().await {
            match cmd {
                EngineCommand::Id(IdParams::Name(n)) => name = n,
                EngineCommand::Id(IdParams::Author(a)) => author = a,
                EngineCommand::Option(option_params) => {
                    options.push(convert_option_params(&option_params));
                }
                EngineCommand::UsiOk => break,
                _ => {} // 他のコマンドは無視（高頻度でくる可能性）
            }
        }

        // リスナー削除
        self.remove_listener(&listener_name).await;

        if name.is_empty() {
            return Err(EngineError::CommunicationFailed(
                "did not receive id name before usiok (or channel closed)".to_string(),
            ));
        }

        let engine_info = EngineInfo {
            name,
            author,
            options,
        };

        // キャッシュ
        self.state.write().await.engine_info = Some(engine_info.clone());

        Ok(engine_info)
    }

    /// プロトコル状態取得
    pub async fn is_ready(&self) -> bool {
        self.state.read().await.is_ready
    }

    /// 軽量な基本情報取得（USI通信なし）
    pub async fn get_basic_info(&self) -> Result<EngineInfo, EngineError> {
        let listen_active = *self.listen_active.lock().await;

        if listen_active {
            // listen開始後は詳細情報取得を使用
            self.get_engine_info().await
        } else {
            // listen開始前のみ直接取得
            let mut handler = self.handler.lock().await;
            let info = handler
                .get_info()
                .map_err(|e| EngineError::StartupFailed(e.to_string()))?;

            let engine_options: Vec<EngineOption> = info
                .options()
                .iter()
                .map(|(name, value)| EngineOption {
                    name: name.clone(),
                    option_type: EngineOptionType::String {
                        default: Some(value.clone()),
                    },
                    default_value: Some(value.clone()),
                    current_value: None,
                })
                .collect();

            Ok(EngineInfo {
                name: info.name().to_string(),
                author: "Unknown".to_string(),
                options: engine_options,
            })
        }
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

    pub async fn kill_engine(&self) {
        log::info!(target: LOGT, "kill_engine: start");
        self.abort_init().await;

        let mut h = self.handler.lock().await;
        let _ = h.kill();
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
