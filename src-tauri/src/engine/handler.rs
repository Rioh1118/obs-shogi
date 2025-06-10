use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{mpsc, RwLock};

use super::communication::UsiCommunication;
use super::types::*;

/// エンジン管理器 - Public API
pub struct EngineManager<R: Runtime> {
    communication: Arc<RwLock<UsiCommunication>>,
    app_handle: AppHandle<R>,
    event_receiver: Arc<RwLock<Option<mpsc::UnboundedReceiver<EngineEvent>>>>,
}

impl<R: Runtime> EngineManager<R> {
    /// 新しいエンジン管理器を作成
    pub fn new(app_handle: AppHandle<R>) -> Self {
        let communication = Arc::new(RwLock::new(UsiCommunication::new()));

        Self {
            communication,
            app_handle,
            event_receiver: Arc::new(RwLock::new(None)),
        }
    }

    /// エンジンイベントの監視を開始
    pub async fn start_event_monitoring(&self) {
        let (sender, receiver) = mpsc::unbounded_channel();

        // 通信モジュールにイベント送信チャンネルを設定
        {
            let mut comm = self.communication.write().await;
            comm.set_event_sender(sender);
        }

        // レシーバーを保存
        *self.event_receiver.write().await = Some(receiver);

        // イベント処理タスクを開始
        let app_handle = self.app_handle.clone();
        let event_receiver = Arc::clone(&self.event_receiver);

        tokio::spawn(async move {
            Self::event_handler_task(app_handle, event_receiver).await;
        });
    }

    /// イベント処理タスク
    async fn event_handler_task(
        app_handle: AppHandle<R>,
        event_receiver: Arc<RwLock<Option<mpsc::UnboundedReceiver<EngineEvent>>>>,
    ) {
        loop {
            // レシーバーからイベントを受信
            let event_opt = {
                let mut receiver_guard = event_receiver.write().await;
                if let Some(receiver) = receiver_guard.as_mut() {
                    receiver.recv().await
                } else {
                    // レシーバーが設定されていない場合は少し待機
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    continue;
                }
            };

            match event_opt {
                Some(event) => {
                    // フロントエンドにイベントを送信
                    if let Err(e) = app_handle.emit("engine-event", &event) {
                        eprintln!("Failed to emit engine event: {}", e);
                    }
                }
                None => {
                    // チャンネルが閉じられた場合は終了
                    break;
                }
            }
        }
    }

    /// エンジンの現在の状態を取得
    pub async fn get_status(&self) -> EngineStatus {
        let comm = self.communication.read().await;
        comm.get_status().await
    }

    /// エンジンが動作中かチェック
    pub async fn is_running(&self) -> bool {
        let comm = self.communication.read().await;
        comm.is_running()
    }

    /// エンジンを起動
    pub async fn start_engine(&self, engine_path: &str) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.start_engine(engine_path).await
    }

    /// エンジンを停止
    pub async fn stop_engine(&self) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.stop_engine().await
    }

    /// 解析を開始
    pub async fn start_analysis(&self, request: StartAnalysisRequest) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.start_analysis(&request).await
    }

    /// 解析を停止
    pub async fn stop_analysis(&self) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.stop_analysis().await
    }

    /// オプション設定
    pub async fn set_option(&self, name: &str, value: Option<&str>) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.set_option(name, value).await
    }

    /// USI準備完了コマンドを送信
    pub async fn send_ready(&self) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.send_command("isready").await
    }

    /// 局面を設定
    pub async fn set_position(&self, sfen: &str) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.send_command(&format!("position sfen {}", sfen)).await
    }

    /// 無制限解析を開始
    pub async fn start_infinite_analysis(&self) -> Result<(), String> {
        let request = StartAnalysisRequest {
            position: "startpos".to_string(),
            infinite: true,
            time_limit: None,
            depth_limit: None,
        };
        self.start_analysis(request).await
    }

    /// 指定時間で解析
    pub async fn start_timed_analysis(&self, position: &str, time_ms: u64) -> Result<(), String> {
        let request = StartAnalysisRequest {
            position: position.to_string(),
            infinite: false,
            time_limit: Some(time_ms),
            depth_limit: None,
        };
        self.start_analysis(request).await
    }

    /// 指定深度で解析
    pub async fn start_depth_analysis(&self, position: &str, depth: i32) -> Result<(), String> {
        let request = StartAnalysisRequest {
            position: position.to_string(),
            infinite: false,
            time_limit: None,
            depth_limit: Some(depth),
        };
        self.start_analysis(request).await
    }

    /// 特定のウィンドウにイベントを送信
    pub async fn emit_to_window(
        &self,
        window_label: &str,
        event: &EngineEvent,
    ) -> Result<(), String> {
        self.app_handle
            .emit_to(window_label, "engine-event", event)
            .map_err(|e| format!("Failed to emit event to window: {}", e))
    }

    /// カスタムコマンドを送信
    pub async fn send_custom_command(&self, command: &str) -> Result<(), String> {
        let mut comm = self.communication.write().await;
        comm.send_command(command).await
    }

    /// リソースをクリーンアップ
    pub async fn cleanup(&self) {
        let _ = self.stop_engine().await;
    }
}

impl<R: Runtime> Drop for EngineManager<R> {
    fn drop(&mut self) {
        // 非同期のクリーンアップは難しいので、簡単な処理のみ
        // 実際のクリーンアップはcleaupメソッドを明示的に呼び出すことを推奨
    }
}

/// エンジン管理器のファクトリー関数
pub fn create_engine_manager<R: Runtime>(app_handle: AppHandle<R>) -> EngineManager<R> {
    EngineManager::new(app_handle)
}
