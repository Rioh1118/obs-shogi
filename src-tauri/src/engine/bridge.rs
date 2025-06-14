use super::analyzer::EngineAnalyzer;
use super::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

use tauri::Emitter;

// グローバルブリッジの代わりにTauri Stateを使用
#[derive(Default)]
pub struct AppState {
    pub bridge: Arc<EngineBridge>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            bridge: Arc::new(EngineBridge::new()),
        }
    }
}

/// Tauriコマンドとエンジン機能の橋渡し
pub struct EngineBridge {
    analyzer: EngineAnalyzer,
    active_sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
    settings: Arc<RwLock<EngineSettings>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

#[derive(Debug)]
struct AnalysisSession {
    session_id: String,
    session_type: SessionType,
    result_receiver: Option<mpsc::UnboundedReceiver<AnalysisResult>>,
    is_active: bool,
}

#[derive(Debug, Clone)]
enum SessionType {
    Infinite,
    Timed(Duration),
    Depth(u32),
}

impl EngineBridge {
    pub fn new() -> Self {
        Self {
            analyzer: EngineAnalyzer::new(),
            active_sessions: Arc::new(RwLock::new(HashMap::new())),
            settings: Arc::new(RwLock::new(EngineSettings::default())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    // AppHandleを設定するメソッド
    pub async fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write().await = Some(handle);
    }

    pub async fn initialize_engine_impl(
        &self,
        engine_path: String,
        working_dir: Option<String>,
    ) -> Result<(), String> {
        println!("🚀 [BRIDGE] initialize_engine_impl called");

        self.analyzer
            .initialize_engine(engine_path, working_dir)
            .await
            .map_err(|e| format!("Engine initialization failed: {:?}", e))
    }

    pub async fn shutdown_engine_impl(&self) -> Result<(), String> {
        println!("[BRIDGE] shutdown_engine_impl called");

        self.stop_all_sessions().await?;

        self.analyzer
            .shutdown()
            .await
            .map_err(|e| format!("Engine shutdown failed: {:?}", e))
    }

    pub async fn set_position_impl(&self, position: String) -> Result<(), String> {
        println!(
            "🎯 [BRIDGE] set_position_impl called with position: {}",
            position
        );
        println!("🎯 [BRIDGE] Position length: {}", position.len());
        self.analyzer
            .set_position(&position)
            .await
            .map_err(|e| format!("Position setting failed: {:?}", e))?;

        println!("✅ [BRIDGE] Position set successfully");
        Ok(())
    }

    pub async fn start_infinite_analysis_impl(&self) -> Result<String, String> {
        println!("🚀 [BRIDGE] start_infinite_analysis_impl called");
        // セッション数チェック
        let current_sessions = self.active_sessions.read().await;
        println!(
            "📊 [BRIDGE] Current active sessions: {}",
            current_sessions.len()
        );
        drop(current_sessions);

        println!("🔄 [BRIDGE] Starting infinite analysis via analyzer...");

        let result_rx = self
            .analyzer
            .start_infinite_analysis()
            .await
            .map_err(|e| format!("Failed to start infinite analysis: {:?}", e))?;

        println!("✅ [BRIDGE] Analyzer returned result receiver");
        let session_id = self.create_session(SessionType::Infinite, result_rx).await;

        println!("✅ [BRIDGE] Session registered: {}", session_id);

        self.start_result_forwarding(&session_id).await;
        Ok(session_id)
    }

    async fn start_result_forwarding(&self, session_id: &str) {
        let app_handle = {
            let handle_guard = self.app_handle.read().await;
            handle_guard.clone()
        };

        if let Some(handle) = app_handle {
            let sessions_clone = Arc::clone(&self.active_sessions);
            let session_id_clone = session_id.to_string();

            tokio::spawn(async move {
                Self::forward_results_to_ui(handle, sessions_clone, session_id_clone).await;
            });
        } else {
            println!("⚠️ [BRIDGE] AppHandle not available for result forwarding");
        }
    }

    /// UI向け結果転送処理
    async fn forward_results_to_ui(
        app_handle: tauri::AppHandle,
        sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
        session_id: String,
    ) {
        println!(
            "🎯 [BRIDGE] Starting result forwarding for session: {}",
            session_id
        );

        let result_receiver = {
            let mut sessions_guard = sessions.write().await;
            if let Some(session) = sessions_guard.get_mut(&session_id) {
                session.result_receiver.take()
            } else {
                println!("❌ [BRIDGE] Session not found: {}", session_id);
                return;
            }
        };

        if let Some(mut receiver) = result_receiver {
            let mut result_count = 0;

            while let Some(result) = receiver.recv().await {
                result_count += 1;
                println!(
                    "📤 [BRIDGE] Forwarding result #{} to UI for session: {}",
                    result_count, session_id
                );

                // UIにイベント送信
                if let Err(e) = app_handle.emit("analysis-update", &result) {
                    println!("❌ [BRIDGE] Failed to emit analysis update: {:?}", e);
                } else {
                    println!("✅ [BRIDGE] Analysis update emitted successfully");
                }
            }

            println!(
                "🏁 [BRIDGE] Result forwarding completed for session: {} (total: {})",
                session_id, result_count
            );
        }
    }

    pub async fn analyze_with_time_impl(
        &self,
        time_seconds: u64,
    ) -> Result<AnalysisResult, String> {
        let duration = Duration::from_secs(time_seconds);

        self.analyzer
            .analyze_with_time(duration)
            .await
            .map_err(|e| format!("Timed analysis failed: {:?}", e))
    }

    pub async fn analyze_with_depth_impl(&self, depth: u32) -> Result<AnalysisResult, String> {
        self.analyzer
            .analyze_with_depth(depth)
            .await
            .map_err(|e| format!("Depth analysis failed: {:?}", e))
    }

    pub async fn stop_analysis_impl(&self, session_id: Option<String>) -> Result<(), String> {
        if let Some(id) = session_id {
            self.stop_session(&id).await
        } else {
            self.stop_all_sessions().await
        }
    }

    pub async fn get_analysis_result_impl(
        &self,
        session_id: String,
    ) -> Result<Option<AnalysisResult>, String> {
        let mut sessions = self.active_sessions.write().await;

        if let Some(session) = sessions.get_mut(&session_id) {
            if let Some(ref mut receiver) = session.result_receiver {
                match receiver.try_recv() {
                    Ok(result) => {
                        println!("[BRIDGE] Retrieved result for session: {}", session_id);
                        Ok(Some(result))
                    }
                    Err(mpsc::error::TryRecvError::Empty) => {
                        println!("[BRIDGE] No result available for session: {}", session_id);
                        Ok(None)
                    }
                    Err(mpsc::error::TryRecvError::Disconnected) => {
                        println!("[BRIDGE] Channel Disconnected for session: {}", session_id);
                        session.is_active = false;
                        Ok(None)
                    }
                }
            } else {
                println!("[BRIDGE] No receiver for session: {}", session_id);
                Ok(None)
            }
        } else {
            println!("[BRIDGE] Session not found: {}", session_id);
            Err("Session not found".to_string())
        }
    }

    pub async fn get_last_result_impl(&self) -> Result<Option<AnalysisResult>, String> {
        Ok(self.analyzer.get_last_result().await)
    }

    pub async fn apply_engine_settings_impl(&self, settings: EngineSettings) -> Result<(), String> {
        println!("⚙️ [BRIDGE] apply_engine_settings_impl called");

        self.analyzer
            .apply_settings(settings.clone())
            .await
            .map_err(|e| format!("Failed to apply settings: {:?}", e))?;

        // 設定を保存
        *self.settings.write().await = settings;

        println!("✅ [BRIDGE] Settings applied successfully");
        Ok(())
    }

    pub async fn get_engine_settings_impl(&self) -> Result<EngineSettings, String> {
        Ok(self.settings.read().await.clone())
    }

    pub async fn get_analysis_status_impl(&self) -> Result<Vec<AnalysisStatus>, String> {
        let sessions = self.active_sessions.read().await;
        let mut statuses = Vec::new();

        for (id, session) in sessions.iter() {
            let status = AnalysisStatus {
                is_analyzing: session.is_active,
                session_id: Some(id.clone()),
                elapsed_time: None,
                config: None,
                analysis_count: self.analyzer.get_analysis_stats().await,
            };
            statuses.push(status);
        }

        Ok(statuses)
    }

    pub async fn get_engine_info_impl(&self) -> Result<Option<EngineInfo>, String> {
        println!("ℹ️ [BRIDGE] get_engine_info_impl called");

        match self.analyzer.get_engine_info().await {
            Ok(info) => {
                println!("✅ [BRIDGE] Engine info retrieved successfully");
                Ok(Some(info))
            }
            Err(EngineError::NotInitialized(_)) => {
                println!("⚠️ [BRIDGE] Engine not initialized");
                Ok(None)
            }
            Err(e) => {
                let error_msg = format!("Failed to get engine info: {:?}", e);
                println!("❌ [BRIDGE] {}", error_msg);
                Err(error_msg)
            }
        }
    }

    // ===  session === //

    async fn create_session(
        &self,
        session_type: SessionType,
        result_receiver: mpsc::UnboundedReceiver<AnalysisResult>,
    ) -> String {
        let session_id = format!(
            "{}_{}",
            match session_type {
                SessionType::Infinite => "infinite",
                SessionType::Timed(_) => "timed",
                SessionType::Depth(_) => "depth",
            },
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        let session = AnalysisSession {
            session_id: session_id.clone(),
            session_type,
            result_receiver: Some(result_receiver),
            is_active: true,
        };

        self.active_sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        session_id
    }

    async fn stop_session(&self, session_id: &str) -> Result<(), String> {
        println!("🛑 [BRIDGE] stop_session called for: {}", session_id);

        let mut sessions = self.active_sessions.write().await;

        if let Some(mut session) = sessions.remove(session_id) {
            session.is_active = false;
            self.analyzer
                .stop_analysis()
                .await
                .map_err(|e| format!("Failed to stop analysis: {:?}", e))?;
        }
        println!("✅ [BRIDGE] Session stopped: {}", session_id);
        Ok(())
    }

    async fn stop_all_sessions(&self) -> Result<(), String> {
        println!("🛑 [BRIDGE] stop_all_sessions called");

        let mut sessions = self.active_sessions.write().await;

        for (_, session) in sessions.iter_mut() {
            session.is_active = false;
        }
        sessions.clear();

        self.analyzer
            .stop_analysis()
            .await
            .map_err(|e| format!("Failed to stop all analysis: {:?}", e))?;

        println!("✅ [BRIDGE] All sessions stopped");
        Ok(())
    }
}

impl Default for EngineBridge {
    fn default() -> Self {
        Self::new()
    }
}

// === Tauriコマンド定義 ===

#[tauri::command]
pub async fn initialize_engine(
    state: tauri::State<'_, AppState>,
    engine_path: String,
    working_dir: Option<String>,
) -> Result<(), String> {
    state
        .bridge
        .initialize_engine_impl(engine_path, working_dir)
        .await
}

#[tauri::command]
pub async fn shutdown_engine(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.bridge.shutdown_engine_impl().await
}

#[tauri::command]
pub async fn set_position(
    state: tauri::State<'_, AppState>,
    position: String,
) -> Result<(), String> {
    state.bridge.set_position_impl(position).await
}

#[tauri::command]
pub async fn start_infinite_analysis(state: tauri::State<'_, AppState>) -> Result<String, String> {
    state.bridge.start_infinite_analysis_impl().await
}

#[tauri::command]
pub async fn analyze_with_time(
    state: tauri::State<'_, AppState>,
    time_seconds: u64,
) -> Result<AnalysisResult, String> {
    state.bridge.analyze_with_time_impl(time_seconds).await
}

#[tauri::command]
pub async fn analyze_with_depth(
    state: tauri::State<'_, AppState>,
    depth: u32,
) -> Result<AnalysisResult, String> {
    state.bridge.analyze_with_depth_impl(depth).await
}

#[tauri::command]
pub async fn stop_analysis(
    state: tauri::State<'_, AppState>,
    session_id: Option<String>,
) -> Result<(), String> {
    state.bridge.stop_analysis_impl(session_id).await
}

#[tauri::command]
pub async fn get_analysis_result(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Option<AnalysisResult>, String> {
    state.bridge.get_analysis_result_impl(session_id).await
}

#[tauri::command]
pub async fn get_last_result(
    state: tauri::State<'_, AppState>,
) -> Result<Option<AnalysisResult>, String> {
    state.bridge.get_last_result_impl().await
}

#[tauri::command]
pub async fn apply_engine_settings(
    state: tauri::State<'_, AppState>,
    settings: EngineSettings,
) -> Result<(), String> {
    state.bridge.apply_engine_settings_impl(settings).await
}

#[tauri::command]
pub async fn get_engine_settings(
    state: tauri::State<'_, AppState>,
) -> Result<EngineSettings, String> {
    state.bridge.get_engine_settings_impl().await
}

#[tauri::command]
pub async fn get_analysis_status(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AnalysisStatus>, String> {
    state.bridge.get_analysis_status_impl().await
}

#[tauri::command]
pub async fn get_engine_info(
    state: tauri::State<'_, AppState>,
) -> Result<Option<EngineInfo>, String> {
    state.bridge.get_engine_info_impl().await
}
