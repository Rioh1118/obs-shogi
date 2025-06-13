use super::types::{EngineStatus, HealthCheckResult};
use crate::engine::protocol::UsiProtocol;
use crate::engine::types::*;
use std::sync::Arc;
use tokio::sync::RwLock;
use usi::UsiEngineHandler;

/// エンジンライフサイクル管理層
pub struct EngineManager {
    protocol: Option<Arc<UsiProtocol>>,
    state: Arc<RwLock<ManagerState>>,
}

#[derive(Debug, Clone)]
struct ManagerState {
    engine_path: Option<String>,
    work_dir: Option<String>,
    is_initialized: bool,
    restart_count: u32,
}

impl EngineManager {
    pub fn new() -> Self {
        Self {
            protocol: None,
            state: Arc::new(RwLock::new(ManagerState {
                engine_path: None,
                work_dir: None,
                is_initialized: false,
                restart_count: 0,
            })),
        }
    }

    /// エンジンを初期化
    pub async fn initialize(
        &mut self,
        engine_path: String,
        work_dir: String,
    ) -> Result<InitializeEngineResponse, EngineError> {
        println!("🚀 [MANAGER] Initializing engine");
        println!("   engine_path: {}", engine_path);
        println!("   work_dir: {}", work_dir);

        // 既存のエンジンがある場合は停止
        if self.is_initialized().await {
            self.shutdown().await?;
        }

        // ハンドラー作成
        let handler = UsiEngineHandler::spawn(&engine_path, &work_dir)
            .map_err(|e| EngineError::StartupFailed(format!("Failed to spawn engine: {}", e)))?;

        println!("✅ [MANAGER] Handler created");

        // プロトコル層作成
        let protocol = Arc::new(UsiProtocol::new(handler));

        // 準備
        protocol.prepare().await?;
        println!("✅ [MANAGER] Engine prepared");

        // エンジン情報取得
        let engine_info = protocol.get_engine_info().await?;
        println!("✅ [MANAGER] Engine info collected: {}", engine_info.name);

        // 状態更新
        {
            let mut state = self.state.write().await;
            state.engine_path = Some(engine_path);
            state.work_dir = Some(work_dir);
            state.is_initialized = true;
        }

        self.protocol = Some(protocol);

        Ok(InitializeEngineResponse {
            engine_info,
            success: true,
        })
    }

    /// エンジン再起動
    pub async fn restart(&mut self) -> Result<InitializeEngineResponse, EngineError> {
        let (engine_path, work_dir) = {
            let state = self.state.read().await;
            if !state.is_initialized {
                return Err(EngineError::NotInitialized(
                    "Engine not initialized, cannot restart".to_string(),
                ));
            }

            let path = state
                .engine_path
                .as_ref()
                .ok_or_else(|| EngineError::NotInitialized("Engine path not set".to_string()))?;
            let dir = state
                .work_dir
                .as_ref()
                .ok_or_else(|| EngineError::NotInitialized("Work dir not set".to_string()))?;

            (path.clone(), dir.clone())
        };

        // 再起動回数更新
        {
            let mut state = self.state.write().await;
            state.restart_count += 1;
        }

        println!("🔄 [MANAGER] Restarting engine (restart #{:?})", {
            let state = self.state.read().await;
            state.restart_count
        });

        // 停止して再初期化
        self.shutdown().await?;
        self.initialize(engine_path, work_dir).await
    }

    /// エンジン停止
    pub async fn shutdown(&mut self) -> Result<(), EngineError> {
        if let Some(protocol) = &self.protocol {
            println!("🛑 [MANAGER] Shutting down engine");

            // アクティブなリスナー数をログ出力
            let listener_count = protocol.listener_count().await;
            if listener_count > 0 {
                println!(
                    "⚠️  [MANAGER] {} active listeners will be disconnected",
                    listener_count
                );
            }
        }

        // プロトコル層を削除
        self.protocol = None;

        // 状態リセット
        {
            let mut state = self.state.write().await;
            state.is_initialized = false;
        }

        println!("✅ [MANAGER] Engine shutdown complete");
        Ok(())
    }

    /// プロトコル層への参照取得
    pub fn protocol(&self) -> Result<Arc<UsiProtocol>, EngineError> {
        self.protocol
            .as_ref()
            .cloned()
            .ok_or_else(|| EngineError::NotInitialized("Engine not initialized".to_string()))
    }

    /// 初期化状態確認
    pub async fn is_initialized(&self) -> bool {
        self.state.read().await.is_initialized
    }

    /// エンジンが準備完了状態かチェック
    pub async fn is_ready(&self) -> bool {
        if let Some(protocol) = &self.protocol {
            protocol.is_ready().await
        } else {
            false
        }
    }

    /// エンジン状態取得
    pub async fn get_status(&self) -> EngineStatus {
        let state = self.state.read().await;

        if !state.is_initialized {
            return EngineStatus {
                is_initialized: false,
                is_ready: false,
                engine_path: None,
                work_dir: None,
                restart_count: state.restart_count,
                listener_count: 0,
            };
        }

        let listener_count = if let Some(protocol) = &self.protocol {
            protocol.listener_count().await
        } else {
            0
        };

        let is_ready = if let Some(protocol) = &self.protocol {
            protocol.is_ready().await
        } else {
            false
        };

        EngineStatus {
            is_initialized: state.is_initialized,
            is_ready,
            engine_path: state.engine_path.clone(),
            work_dir: state.work_dir.clone(),
            restart_count: state.restart_count,
            listener_count,
        }
    }

    /// 基本情報取得（高速）
    pub async fn get_basic_info(&self) -> Result<EngineInfo, EngineError> {
        let protocol = self.protocol()?;
        protocol.get_basic_info().await
    }

    /// 詳細情報取得（USI通信あり）
    pub async fn get_detailed_info(&self) -> Result<EngineInfo, EngineError> {
        let protocol = self.protocol()?;
        protocol.get_engine_info().await
    }

    /// ヘルスチェック
    pub async fn health_check(&self) -> Result<HealthCheckResult, EngineError> {
        if !self.is_initialized().await {
            return Ok(HealthCheckResult {
                is_healthy: false,
                message: "Engine not initialized".to_string(),
                details: None,
            });
        }

        let protocol = self.protocol()?;

        // 基本情報取得を試行（軽量なヘルスチェック）
        match protocol.get_basic_info().await {
            Ok(info) => Ok(HealthCheckResult {
                is_healthy: true,
                message: format!("Engine '{}' is healthy", info.name),
                details: Some(format!(
                    "Ready: {}, Listeners: {}",
                    protocol.is_ready().await,
                    protocol.listener_count().await
                )),
            }),
            Err(e) => Ok(HealthCheckResult {
                is_healthy: false,
                message: "Engine communication failed".to_string(),
                details: Some(e.to_string()),
            }),
        }
    }
}

impl Default for EngineManager {
    fn default() -> Self {
        Self::new()
    }
}
