use crate::engine::utils::{
    extract_rank, get_depth_of_rank, get_or_create_candidate, map_score_to_evaluation,
};

use super::manager::EngineManager;
use super::types::*;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex, RwLock};
use usi::{EngineCommand, GuiCommand, InfoParams, ThinkParams};

/// 将棋エンジン分析層 - 純粋な分析機能のみ提供
#[derive(Default)]
pub struct EngineAnalyzer {
    manager: Arc<Mutex<EngineManager>>,
    state: Arc<RwLock<AnalyzerState>>,
}

#[derive(Debug, Clone, Default)]
struct AnalyzerState {
    current_position: Option<String>,
    last_result: Option<AnalysisResult>,
    analysis_count: u64,
}

impl EngineAnalyzer {
    pub fn new() -> Self {
        let manager = Arc::new(Mutex::new(EngineManager::new()));
        Self {
            manager,
            state: Arc::new(RwLock::new(AnalyzerState::default())),
        }
    }

    pub async fn initialize_engine(
        &self,
        engine_path: String,
        working_dir: Option<String>,
    ) -> Result<(), EngineError> {
        let mut manager = self.manager.lock().await;
        let work_dir = working_dir.unwrap_or_else(|| {
            std::path::Path::new(&engine_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(".".to_string())
        });

        manager.initialize(engine_path, work_dir).await.map(|_| ())
    }

    pub async fn apply_settings(&self, settings: EngineSettings) -> Result<(), EngineError> {
        let manager = self.manager.lock().await;
        let protocol = manager.protocol()?;

        for (name, value) in &settings.options {
            let cmd = GuiCommand::SetOption(name.clone(), Some(value.clone()));
            protocol.send_command(&cmd).await?;
        }

        protocol.send_command(&GuiCommand::IsReady).await?;
        protocol.send_command(&GuiCommand::UsiNewGame).await?;
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), EngineError> {
        let mut manager = self.manager.lock().await;
        manager.shutdown().await
    }

    pub async fn get_engine_info(&self) -> Result<EngineInfo, EngineError> {
        let manager = self.manager.lock().await;
        manager.get_detailed_info().await
    }

    /// 局面を設定
    pub async fn set_position(&self, position: &str) -> Result<(), EngineError> {
        let manager_guard = self.manager.lock().await;
        if !manager_guard.is_initialized().await {
            return Err(EngineError::NotInitialized(
                "Engine not initialized".to_string(),
            ));
        }
        let protocol = manager_guard.protocol()?;
        drop(manager_guard);

        let position_command = GuiCommand::Position(position.to_string());
        protocol.send_command(&position_command).await?;

        // 状態更新
        self.state.write().await.current_position = Some(position.to_string());

        Ok(())
    }

    /// 無限解析開始
    pub async fn start_infinite_analysis(
        &self,
    ) -> Result<mpsc::UnboundedReceiver<AnalysisResult>, EngineError> {
        println!("[ANALYZER] start_infinite_analysis called");

        let manager_guard = self.manager.lock().await;
        if !manager_guard.is_initialized().await {
            return Err(EngineError::NotInitialized(
                "Engine not initialized".to_string(),
            ));
        }

        let protocol = manager_guard.protocol()?;
        drop(manager_guard);

        // 結果チャンネル作成
        let (result_tx, result_rx) = mpsc::unbounded_channel();

        // エンジンコマンド受信チャンネル
        let (raw_tx, raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!(
            "infinite_analysis_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        println!("🎧 [ANALYZER] Registering listener: {}", listener_id);

        protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await?;

        // 無限解析開始
        let go_command = GuiCommand::Go(ThinkParams::new().infinite());
        println!("🚀 [ANALYZER] Sending Go command: {:?}", go_command);

        match protocol.send_command(&go_command).await {
            Ok(_) => {
                println!("✅ [ANALYZER] Go command sent successfully");
            }
            Err(e) => {
                println!("❌ [ANALYZER] Failed to send Go command: {:?}", e);
                return Err(e);
            }
        }

        // 結果処理タスク開始前にログ
        println!("🧵 [ANALYZER] About to spawn process_analysis_stream task");

        // 結果処理タスク
        let state_clone = Arc::clone(&self.state);
        let listener_id_clone = listener_id.clone();

        let protocol_for_task = protocol.clone();
        let listener_id_for_task = listener_id.clone();

        tokio::spawn(async move {
            println!(
                "🧵 [ANALYZER] Starting process_analysis_stream task for listener: {}",
                listener_id_clone
            );
            Self::process_analysis_stream(raw_rx, result_tx, state_clone).await;
            let _ = protocol_for_task
                .remove_listener(&listener_id_for_task)
                .await;
            println!(
                "🏁 [ANALYZER] process_analysis_stream task finished for listener: {}",
                listener_id_clone
            );
        });

        Ok(result_rx)
    }

    /// 固定時間解析
    pub async fn analyze_with_time(
        &self,
        time_limit: Duration,
    ) -> Result<AnalysisResult, EngineError> {
        let manager_guard = self.manager.lock().await;
        if !manager_guard.is_initialized().await {
            return Err(EngineError::NotInitialized(
                "Engine not initialized".to_string(),
            ));
        }
        let protocol = manager_guard.protocol()?;
        drop(manager_guard);

        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!(
            "timed_analysis_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await?;

        // 時間制限付き解析開始
        let go_command = GuiCommand::Go(ThinkParams::new().byoyomi(time_limit));
        protocol.send_command(&go_command).await?;

        // 結果収集
        let result = self.collect_single_result(&mut raw_rx, time_limit).await;

        // クリーンアップ
        protocol.remove_listener(&listener_id).await;

        let analysis_result = result?;

        // 状態更新
        {
            let mut state = self.state.write().await;
            state.last_result = Some(analysis_result.clone());
            state.analysis_count += 1;
        }

        Ok(analysis_result)
    }

    /// 深度制限解析
    pub async fn analyze_with_depth(
        &self,
        depth_limit: u32,
    ) -> Result<AnalysisResult, EngineError> {
        let manager_guard = self.manager.lock().await;
        if !manager_guard.is_initialized().await {
            return Err(EngineError::NotInitialized(
                "Engine not initialized".to_string(),
            ));
        }
        let protocol = manager_guard.protocol()?;
        drop(manager_guard);

        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!(
            "depth_analysis_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await?;

        // 深度制限解析 - 時間制限も併用
        let go_command = GuiCommand::Go(
            ThinkParams::new().byoyomi(Duration::from_secs(60)), // 最大60秒
        );
        protocol.send_command(&go_command).await?;

        // 結果収集（深度チェック付き）
        let result = self
            .collect_result_with_depth(&mut raw_rx, depth_limit)
            .await;

        // クリーンアップ
        protocol.remove_listener(&listener_id).await;

        let analysis_result = result?;

        // 状態更新
        {
            let mut state = self.state.write().await;
            state.last_result = Some(analysis_result.clone());
            state.analysis_count += 1;
        }

        Ok(analysis_result)
    }

    /// 解析停止
    pub async fn stop_analysis(&self) -> Result<(), EngineError> {
        let manager_guard = self.manager.lock().await;
        if !manager_guard.is_initialized().await {
            return Err(EngineError::NotInitialized(
                "Engine not initialized".to_string(),
            ));
        }
        let protocol = manager_guard.protocol()?;
        drop(manager_guard);

        protocol.send_command(&GuiCommand::Stop).await?;
        Ok(())
    }

    /// 最後の分析結果取得
    pub async fn get_last_result(&self) -> Option<AnalysisResult> {
        self.state.read().await.last_result.clone()
    }

    /// 分析統計取得
    pub async fn get_analysis_stats(&self) -> u64 {
        self.state.read().await.analysis_count
    }

    /// 現在の局面取得
    pub async fn get_current_position(&self) -> Option<String> {
        self.state.read().await.current_position.clone()
    }

    // === 内部ヘルパーメソッド ===

    /// 分析ストリーム処理（無限解析用）
    async fn process_analysis_stream(
        mut raw_rx: mpsc::UnboundedReceiver<EngineCommand>,
        result_tx: mpsc::UnboundedSender<AnalysisResult>,
        state: Arc<RwLock<AnalyzerState>>,
    ) {
        println!("🔄 [ANALYZER] process_analysis_stream started, waiting for engine commands...");

        let mut current_result = AnalysisResult::default();
        let mut command_count = 0;

        while let Some(cmd) = raw_rx.recv().await {
            command_count += 1;
            println!(
                "📨 [ANALYZER] Received engine command #{}: {:?}",
                command_count, cmd
            );

            match cmd {
                EngineCommand::Info(info_params) => {
                    println!("📊 [ANALYZER] Processing Info params: {:?}", info_params);
                    Self::process_info_params(&info_params, &mut current_result);
                    // 更新された結果を送信
                    if let Err(e) = result_tx.send(current_result.clone()) {
                        println!("❌ [ANALYZER] Failed to send result: {:?}", e);
                        break;
                    } else {
                        println!("✅ [ANALYZER] Sent analysis result update");
                    }
                }
                EngineCommand::Checkmate(checkmate_params) => {
                    println!(
                        "📊 [ANALYZER] Processing checkmate params: {:?}",
                        checkmate_params
                    );
                    Self::process_checkmate(&checkmate_params, &mut current_result);

                    if let Err(e) = result_tx.send(current_result.clone()) {
                        println!("❌ [ANALYZER] Failed to send final result: {:?}", e);
                    } else {
                        println!("✅ [ANALYZER] Sent final analysis result");
                    }
                }

                EngineCommand::BestMove(_) => {
                    // 最終結果を送信して終了
                    if let Err(e) = result_tx.send(current_result.clone()) {
                        println!("❌ [ANALYZER] Failed to send final result: {:?}", e);
                    } else {
                        println!("✅ [ANALYZER] Sent final analysis result");
                    }

                    // 状態更新
                    {
                        let mut state_guard = state.write().await;
                        state_guard.last_result = Some(current_result);
                        state_guard.analysis_count += 1;
                    }
                    println!("🏁 [ANALYZER] Analysis completed, breaking loop");
                    break;
                }
                _ => {
                    println!("🔍 [ANALYZER] Ignoring command: {:?}", cmd);
                }
            }
        }

        println!(
            "📊 [ANALYZER] process_analysis_stream finished. Total commands processed: {}",
            command_count
        );
    }

    /// 単一結果収集
    async fn collect_single_result(
        &self,
        raw_rx: &mut mpsc::UnboundedReceiver<EngineCommand>,
        timeout: Duration,
    ) -> Result<AnalysisResult, EngineError> {
        let mut result = AnalysisResult::default();
        let start_time = Instant::now();

        while start_time.elapsed() < timeout {
            match tokio::time::timeout(Duration::from_millis(100), raw_rx.recv()).await {
                Ok(Some(cmd)) => match cmd {
                    EngineCommand::Info(info_params) => {
                        Self::process_info_params(&info_params, &mut result);
                    }
                    EngineCommand::Checkmate(checkmate_params) => {
                        Self::process_checkmate(&checkmate_params, &mut result);
                    }
                    EngineCommand::BestMove(_) => {
                        return Ok(result);
                    }
                    _ => {}
                },
                Ok(None) => {
                    return Err(EngineError::CommunicationFailed(
                        "Channel closed".to_string(),
                    ));
                }
                Err(_) => continue, // タイムアウト継続
            }
        }

        Err(EngineError::Timeout("Analysis timeout".to_string()))
    }

    /// 深度制限付き結果収集
    async fn collect_result_with_depth(
        &self,
        raw_rx: &mut mpsc::UnboundedReceiver<EngineCommand>,
        target_depth: u32,
    ) -> Result<AnalysisResult, EngineError> {
        let mut result = AnalysisResult::default();
        let timeout = Duration::from_secs(60);
        let start_time = Instant::now();

        while start_time.elapsed() < timeout {
            match tokio::time::timeout(Duration::from_millis(100), raw_rx.recv()).await {
                Ok(Some(cmd)) => {
                    match cmd {
                        EngineCommand::Info(info_params) => {
                            Self::process_info_params(&info_params, &mut result);

                            // 目標深度に達したら停止
                            if let Some(depth) = get_depth_of_rank(&result, 1) {
                                if depth >= target_depth {
                                    self.stop_analysis().await?;
                                }
                            }
                        }
                        EngineCommand::Checkmate(checkmate_params) => {
                            Self::process_checkmate(&checkmate_params, &mut result);
                        }
                        EngineCommand::BestMove(_) => {
                            return Ok(result);
                        }
                        _ => {}
                    }
                }
                Ok(None) => {
                    return Err(EngineError::CommunicationFailed(
                        "Channel closed".to_string(),
                    ));
                }
                Err(_) => continue, // タイムアウト継続
            }
        }

        Err(EngineError::Timeout("Analysis timeout".to_string()))
    }

    /// InfoParams処理
    fn process_info_params(info_params: &[InfoParams], result: &mut AnalysisResult) {
        let rank = extract_rank(info_params);

        for info in info_params {
            match info {
                InfoParams::MultiPv(_) => {}
                InfoParams::Depth(depth, _seldepth) => {
                    let c = get_or_create_candidate(result, rank);
                    c.depth = Some(*depth as u32);
                }
                InfoParams::Nodes(nodes) => {
                    let c = get_or_create_candidate(result, rank);
                    c.nodes = Some(*nodes as u64);
                }
                InfoParams::Time(time) => {
                    let c = get_or_create_candidate(result, rank);
                    c.time_ms = Some(time.as_millis() as u64);
                }
                InfoParams::Pv(moves) => {
                    let c = get_or_create_candidate(result, rank);
                    c.pv_line = moves.clone();
                    c.first_move = moves.first().cloned();
                }
                InfoParams::Score(value, kind) => {
                    let eval = map_score_to_evaluation(*value, kind);
                    let c = get_or_create_candidate(result, rank);
                    c.evaluation = Some(eval);
                }
                _ => {}
            }
        }
        result.candidates.sort_by_key(|c| c.rank);
    }

    fn process_checkmate(params: &usi::CheckmateParams, result: &mut AnalysisResult) {
        use usi::CheckmateParams;

        match params {
            CheckmateParams::Mate(moves) => {
                result.mate_sequence = Some(moves.clone());
            }
            CheckmateParams::NoMate => {
                // 「詰み探索したが詰み無し」を表す
                result.mate_sequence = Some(Vec::new());
            }
            CheckmateParams::NotImplemented | CheckmateParams::Timeout => {
                // 最低限、結果としては「手順なし」にしておく
                // ここは将来、別フィールドに拡張しても良い
                result.mate_sequence = Some(Vec::new());
            }
        }
    }
}

impl Clone for EngineAnalyzer {
    fn clone(&self) -> Self {
        Self {
            manager: Arc::clone(&self.manager),
            state: Arc::clone(&self.state),
        }
    }
}
