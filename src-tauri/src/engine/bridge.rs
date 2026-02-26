use crate::engine::utils::LogThrottle;

use super::analyzer::EngineAnalyzer;
use super::types::*;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

use tauri::Emitter;

const LOGT: &str = "obs_shogi::engine::bridge";

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
    last_result: Option<AnalysisResult>,
    is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AnalysisUpdate {
    session_id: String,
    result: AnalysisResult,
}

#[derive(Debug, Clone)]
enum SessionType {
    Infinite,
    #[allow(dead_code)]
    Timed(Duration),
    #[allow(dead_code)]
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
        log::info!(target: LOGT, "initialize_engine: start");

        match self
            .analyzer
            .initialize_engine(engine_path, working_dir)
            .await
        {
            Ok(_) => {
                log::info!(target: LOGT, "initialize_engine: ok");
                Ok(())
            }
            Err(e) => {
                log::error!(target: LOGT, "initialize_engine: failed: {:?}", e);
                Err(format!("Engine initialization failed: {:?}", e))
            }
        }
    }

    async fn ensure_no_active_session(&self) -> Result<(), String> {
        let sessions = self.active_sessions.read().await;
        let has_active = sessions.values().any(|s| s.is_active);
        if has_active {
            return Err("Analysis already running".to_string());
        }
        Ok(())
    }

    pub async fn shutdown_engine_impl(&self) -> Result<(), String> {
        log::info!(target: LOGT, "shutdown_engine: start");

        self.stop_all_sessions().await?;

        match self.analyzer.shutdown().await {
            Ok(_) => {
                log::info!(target: LOGT, "shutdown_engine: ok");
                Ok(())
            }
            Err(e) => {
                log::error!(target: LOGT, "shutdown_engine: failed: {:?}", e);
                Err(format!("Engine shutdown failed: {:?}", e))
            }
        }
    }

    pub async fn set_position_impl(&self, position: String) -> Result<(), String> {
        log::debug!(target: LOGT, "set_position: len={}", position.len());

        self.analyzer.set_position(&position).await.map_err(|e| {
            log::warn!(target: LOGT, "set_position: failed: {:?}", e);
            format!("Position setting failed: {:?}", e)
        })?;

        log::debug!(target: LOGT, "set_position: ok");
        Ok(())
    }

    pub async fn start_infinite_analysis_impl(&self) -> Result<String, String> {
        if let Err(e) = self.ensure_no_active_session().await {
            log::warn!(target: LOGT, "start_infinite_analysis: rejected: {}", e);
            return Err(e);
        }

        log::debug!(target: LOGT, "start_infinite_analysis: requested");

        let result_rx = self.analyzer.start_infinite_analysis().await.map_err(|e| {
            log::error!(
                target: LOGT,
                "start_infinite_analysis: analyzer failed: {:?}",
                e
            );
            format!("Failed to start infinite analysis: {:?}", e)
        })?;

        let session_id = self.create_session(SessionType::Infinite).await;
        log::info!(
            target: LOGT,
            "start_infinite_analysis: ok session_id={}",
            session_id
        );

        self.start_result_forwarding(&session_id, result_rx).await;
        Ok(session_id)
    }

    async fn start_result_forwarding(
        &self,
        session_id: &str,
        receiver: mpsc::UnboundedReceiver<AnalysisResult>,
    ) {
        let sessions_clone = Arc::clone(&self.active_sessions);
        let app_handle_clone = Arc::clone(&self.app_handle);
        let session_id_clone = session_id.to_string();

        tokio::spawn(async move {
            Self::forward_results_to_ui(
                app_handle_clone,
                sessions_clone,
                session_id_clone,
                receiver,
            )
            .await;
        });
    }

    /// UI向け結果転送処理
    async fn forward_results_to_ui(
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
        sessions: Arc<RwLock<HashMap<String, AnalysisSession>>>,
        session_id: String,
        mut receiver: mpsc::UnboundedReceiver<AnalysisResult>,
    ) {
        // session が消えたら emit/保存をやめるためのフラグ
        let mut session_exists = true;

        // emit失敗は5秒に1回だけwarn
        let mut emit_warn = LogThrottle::new(Duration::from_secs(5));
        // session消失も1回だけdebug
        let mut session_missing_logged = false;

        while let Some(result) = receiver.recv().await {
            // session がまだあるなら last_result を保存 & active なら emit
            let mut emit = false;

            if session_exists {
                let mut sessions_guard = sessions.write().await;
                if let Some(session) = sessions_guard.get_mut(&session_id) {
                    session.last_result = Some(result.clone());
                    emit = session.is_active;
                } else {
                    session_exists = false;
                    if !session_missing_logged {
                        log::debug!(
                            target: LOGT,
                            "forward_results: session disappeared; draining only session_id={}",
                            session_id
                        );
                        session_missing_logged = true;
                    }
                }
            }

            // emit は session が存在して active の時だけ
            if emit {
                if let Some(handle) = app_handle.read().await.clone() {
                    let payload = AnalysisUpdate {
                        session_id: session_id.clone(),
                        result,
                    };
                    if let Err(e) = handle.emit("analysis-update", payload) {
                        if emit_warn.allow() {
                            log::warn!(
                                target: LOGT,
                                "forward_results: emit failed session_id={} err={}",
                                session_id,
                                e
                            );
                        }
                    }
                }
            }
            // session が消えた後は、receiver を drop せずに drain 継続する
        }

        // receiver が閉じた（analyzer 側が終了）ので最後に状態だけ落とす
        {
            let mut sessions_guard = sessions.write().await;
            if let Some(session) = sessions_guard.get_mut(&session_id) {
                session.is_active = false;
            }
        }
        log::debug!(
            target: LOGT,
            "forward_results: ended session_id={}",
            session_id
        );
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
        let sessions = self.active_sessions.read().await;
        match sessions.get(&session_id) {
            Some(session) => Ok(session.last_result.clone()),
            None => Err("Session not found".to_string()),
        }
    }

    pub async fn get_last_result_impl(&self) -> Result<Option<AnalysisResult>, String> {
        Ok(self.analyzer.get_last_result().await)
    }

    pub async fn apply_engine_settings_impl(&self, settings: EngineSettings) -> Result<(), String> {
        log::info!(
            target: LOGT,
            "apply_engine_settings: start options={}",
            settings.options.len()
        );

        self.analyzer
            .apply_settings(settings.clone())
            .await
            .map_err(|e| {
                log::error!(target: LOGT, "apply_engine_settings: failed: {:?}", e);
                format!("Failed to apply settings: {:?}", e)
            })?;

        // 設定を保存
        *self.settings.write().await = settings;

        log::info!(target: LOGT, "apply_engine_settings: ok");
        Ok(())
    }

    pub async fn get_engine_settings_impl(&self) -> Result<EngineSettings, String> {
        Ok(self.settings.read().await.clone())
    }

    pub async fn get_analysis_status_impl(&self) -> Result<Vec<AnalysisStatus>, String> {
        let analysis_count = self.analyzer.get_analysis_stats().await;
        let sessions = self.active_sessions.read().await;

        let statuses = sessions
            .iter()
            .map(|(id, session)| AnalysisStatus {
                is_analyzing: session.is_active,
                session_id: Some(id.clone()),
                elapsed_time: None,
                config: None,
                analysis_count,
            })
            .collect();

        Ok(statuses)
    }

    pub async fn get_engine_info_impl(&self) -> Result<Option<EngineInfo>, String> {
        log::debug!(target: LOGT, "get_engine_info");

        match self.analyzer.get_engine_info().await {
            Ok(info) => Ok(Some(info)),
            Err(EngineError::NotInitialized(_)) => Ok(None),
            Err(e) => {
                log::warn!(target: LOGT, "get_engine_info: failed: {:?}", e);
                Err(format!("Failed to get engine info: {:?}", e))
            }
        }
    }

    // ===  session === //

    async fn create_session(&self, session_type: SessionType) -> String {
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
            last_result: None,
            is_active: true,
        };

        self.active_sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        session_id
    }

    async fn stop_session(&self, session_id: &str) -> Result<(), String> {
        log::info!(
            target: LOGT,
            "stop_session: start session_id={}",
            session_id
        );

        {
            let mut sessions = self.active_sessions.write().await;
            if let Some(mut session) = sessions.remove(session_id) {
                session.is_active = false;
            }
        }

        self.analyzer.stop_analysis().await.map_err(|e| {
            log::error!(target: LOGT, "stop_session: analyzer stop failed: {:?}", e);
            format!("Failed to stop analysis: {:?}", e)
        })?;

        log::info!(target: LOGT, "stop_session: ok session_id={}", session_id);
        Ok(())
    }

    async fn stop_all_sessions(&self) -> Result<(), String> {
        log::info!(target: LOGT, "stop_all_sessions: start");

        {
            let mut sessions = self.active_sessions.write().await;

            for (_, session) in sessions.iter_mut() {
                session.is_active = false;
            }
            sessions.clear();
        }

        self.analyzer.stop_analysis().await.map_err(|e| {
            log::error!(
                target: LOGT,
                "stop_all_sessions: analyzer stop failed: {:?}",
                e
            );
            format!("Failed to stop all analysis: {:?}", e)
        })?;

        log::info!(target: LOGT, "stop_all_sessions: ok");
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
