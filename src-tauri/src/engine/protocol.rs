use crate::engine::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use usi::{EngineCommand, Error as UsiError, GuiCommand, IdParams, OptionParams, UsiEngineHandler};

/// USI プロトコル処理層
pub struct UsiProtocol {
    handler: Arc<Mutex<UsiEngineHandler>>,
    state: Arc<RwLock<ProtocolState>>,
    listeners: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<EngineCommand>>>>,
    listen_active: Arc<Mutex<bool>>,

    runtime_handle: tokio::runtime::Handle,
}

#[derive(Debug, Clone)]
struct ProtocolState {
    is_ready: bool,
    engine_info: Option<EngineInfo>,
    last_command: Option<String>,
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

        // リスニング開始チェック（1回だけ）
        let mut listen_active = self.listen_active.lock().await;
        if !*listen_active {
            self.start_listening().await?;
            *listen_active = true;
        }

        Ok(())
    }

    /// リスナー削除
    pub async fn remove_listener(&self, name: &str) {
        self.listeners.write().await.remove(name);
    }

    /// リスニング開始(内部用)
    async fn start_listening(&self) -> Result<(), EngineError> {
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
                EngineError::AlreadyListening(e.to_string())
            } else {
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
        self.state.write().await.last_command = Some(format!("{:?}", command));

        // スレッドセーフな送信
        let mut handler = self.handler.lock().await;
        handler
            .send_command(command)
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;

        Ok(())
    }

    /// エンジン準備
    pub async fn prepare(&self) -> Result<(), EngineError> {
        let mut handler = self.handler.lock().await;
        handler
            .prepare()
            .map_err(|e| EngineError::StartupFailed(e.to_string()))?;

        drop(handler);

        self.state.write().await.is_ready = true;
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

        let timeout = std::time::Duration::from_secs(10);
        let start_time = std::time::Instant::now();

        while start_time.elapsed() < timeout {
            match tokio::time::timeout(std::time::Duration::from_millis(50), rx.recv()).await {
                Ok(Some(cmd)) => {
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
                Ok(None) => {
                    return Err(EngineError::CommunicationFailed(
                        "Channel closed".to_string(),
                    ));
                }
                Err(_) => continue, // タイムアウト - 続行
            }
        }

        // リスナー削除
        self.remove_listener(&listener_name).await;

        if name.is_empty() {
            name = "Unknown Engine".to_string();
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
