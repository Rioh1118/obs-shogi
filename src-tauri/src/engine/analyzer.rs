use crate::engine::utils::{
    extract_rank, get_or_create_candidate, map_score_to_evaluation, LogThrottle,
};

use super::manager::EngineManager;
use super::protocol::UsiProtocol;
use super::types::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, RwLock};
use usi::{EngineCommand, GuiCommand, InfoParams, MateParam, ThinkParams};

const LOGT: &str = "obs_shogi::engine::analyzer";

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn contains_usi_breaking_char(s: &str) -> bool {
    s.chars().any(|c| c == '\n' || c == '\r' || c == '\0')
}

/// 将棋エンジン分析層 - 純粋な分析機能のみ提供
pub struct EngineAnalyzer {
    manager: Arc<Mutex<EngineManager>>,
    state: Arc<RwLock<AnalyzerState>>,
    infinite_stop_requested: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

impl Default for EngineAnalyzer {
    fn default() -> Self {
        Self::new()
    }
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
            infinite_stop_requested: Arc::new(Mutex::new(None)),
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
            // USI プロトコルは行指向なので、name/value への改行注入を拒否する
            if contains_usi_breaking_char(name) || contains_usi_breaking_char(value) {
                return Err(EngineError::CommunicationFailed(
                    "setoption name/value contains forbidden control character".to_string(),
                ));
            }
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
        // USI プロトコルは行指向なので、position 文字列への改行注入を拒否する
        if contains_usi_breaking_char(position) {
            return Err(EngineError::CommunicationFailed(
                "position string contains forbidden control character".to_string(),
            ));
        }

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

    /// 設定駆動の解析開始。`AnalysisConfig` の variant が停止条件と go コマンド形を決める。
    ///
    /// - `Infinite`: 外部 `stop_analysis()` を待つ。stop が立つまで bestmove は stale とみなす
    /// - `Time { seconds }`: `byoyomi <ms>` で送る。usi crate 0.6.2 は `go movetime` を
    ///   ThinkParams で表現できないため byoyomi で近似している
    /// - `Depth { plies }` / `Nodes { count }`: ceiling として byoyomi 10 分を付け、
    ///   rank1 が閾値到達した時点で Stop を送る
    /// - `Mate`: `go mate infinite` を送る
    pub async fn start_analysis(
        &self,
        config: AnalysisConfig,
    ) -> Result<mpsc::UnboundedReceiver<AnalysisResult>, EngineError> {
        log::debug!(
            target: LOGT,
            "analysis.start: mode={}",
            config.mode_tag()
        );

        let manager_guard = self.manager.lock().await;
        if !manager_guard.is_initialized().await {
            return Err(EngineError::NotInitialized(
                "Engine not initialized".to_string(),
            ));
        }
        let protocol = manager_guard.protocol()?;
        drop(manager_guard);

        // Infinite モードのみ外部 stop 用のフラグを登録する
        let stop_flag = if matches!(config, AnalysisConfig::Infinite) {
            let flag = Arc::new(AtomicBool::new(false));
            *self.infinite_stop_requested.lock().await = Some(Arc::clone(&flag));
            Some(flag)
        } else {
            None
        };

        let go_command = build_go_command(&config);

        let (result_tx, result_rx) = mpsc::unbounded_channel();
        let (raw_tx, raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!("analysis_{}_{}", config.mode_tag(), now_nanos());

        if let Err(e) = protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await
        {
            log::error!(target: LOGT, "analysis.start: register_listener failed: {:?}", e);
            return Err(e);
        }

        if let Err(e) = protocol.send_command(&go_command).await {
            log::error!(target: LOGT, "analysis.start: send_command failed: {:?}", e);
            let _ = protocol.remove_listener(&listener_id).await;
            return Err(e);
        }

        log::info!(
            target: LOGT,
            "analysis.started listener_id={} mode={}",
            listener_id,
            config.mode_tag()
        );

        let state_clone = Arc::clone(&self.state);
        let protocol_for_task = protocol.clone();
        let listener_id_for_task = listener_id.clone();

        tokio::spawn(async move {
            Self::process_analysis_stream(
                raw_rx,
                result_tx,
                state_clone,
                config,
                stop_flag,
                protocol_for_task.clone(),
            )
            .await;

            protocol_for_task
                .remove_listener(&listener_id_for_task)
                .await;
        });

        Ok(result_rx)
    }

    pub async fn stop_analysis(&self) -> Result<(), EngineError> {
        let manager_guard = self.manager.lock().await;
        if !manager_guard.is_initialized().await {
            return Err(EngineError::NotInitialized(
                "Engine not initialized".to_string(),
            ));
        }
        let protocol = manager_guard.protocol()?;
        drop(manager_guard);

        if let Some(flag) = self.infinite_stop_requested.lock().await.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }

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

    /// 分析ストリーム処理。`config` の振る舞いメソッドが停止判定と bestmove 処理を担う。
    async fn process_analysis_stream(
        mut raw_rx: mpsc::UnboundedReceiver<EngineCommand>,
        result_tx: mpsc::UnboundedSender<AnalysisResult>,
        state: Arc<RwLock<AnalyzerState>>,
        config: AnalysisConfig,
        stop_flag: Option<Arc<AtomicBool>>,
        protocol: Arc<UsiProtocol>,
    ) {
        let mut current_result = AnalysisResult::default();
        let mut stop_sent = false;
        let mut stale_bestmove_warn = LogThrottle::new(Duration::from_secs(5));

        while let Some(cmd) = raw_rx.recv().await {
            match cmd {
                EngineCommand::Info(info_params) => {
                    Self::process_info_params(&info_params, &mut current_result);
                    if result_tx.send(current_result.clone()).is_err() {
                        break;
                    }

                    if !stop_sent && config.should_stop_on_info(&current_result) {
                        if let Err(e) = protocol.send_command(&GuiCommand::Stop).await {
                            log::warn!(
                                target: LOGT,
                                "stream: threshold stop send failed: {:?}",
                                e
                            );
                        }
                        stop_sent = true;
                    }
                }
                EngineCommand::Checkmate(checkmate_params) => {
                    Self::process_checkmate(&checkmate_params, &mut current_result);
                    let _ = result_tx.send(current_result.clone());
                }
                EngineCommand::BestMove(_) => match config.handle_bestmove() {
                    BestmoveAction::Finish => {
                        let _ = result_tx.send(current_result.clone());
                        break;
                    }
                    BestmoveAction::IgnoreUnlessStopped => {
                        let stopped = stop_flag
                            .as_ref()
                            .is_some_and(|f| f.load(Ordering::SeqCst));
                        if !stopped {
                            if stale_bestmove_warn.allow() {
                                log::warn!(
                                    target: LOGT,
                                    "stream: bestmove received without stop request; ignoring (stale?)"
                                );
                            }
                            continue;
                        }
                        let _ = result_tx.send(current_result.clone());
                        break;
                    }
                },
                _ => {}
            }
        }
        {
            let mut st = state.write().await;
            st.last_result = Some(current_result);
            st.analysis_count = st.analysis_count.wrapping_add(1);
        }
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

/// `AnalysisConfig` から USI go コマンドを組み立てる。
///
/// - `Time` は usi 0.6.2 が `go movetime` を ThinkParams で表現できないため byoyomi で近似
/// - `Depth` / `Nodes` には ceiling として byoyomi 10 分を付け、閾値到達時の Stop で打ち切る
fn build_go_command(config: &AnalysisConfig) -> GuiCommand {
    const THRESHOLD_CEILING: Duration = Duration::from_secs(600);

    let params = match config {
        AnalysisConfig::Infinite => ThinkParams::new().infinite(),
        AnalysisConfig::Time { seconds } => {
            ThinkParams::new().byoyomi(Duration::from_secs(*seconds))
        }
        AnalysisConfig::Depth { .. } | AnalysisConfig::Nodes { .. } => {
            ThinkParams::new().byoyomi(THRESHOLD_CEILING)
        }
        AnalysisConfig::Mate => ThinkParams::new().mate(MateParam::Infinite),
    };
    GuiCommand::Go(params)
}

impl Clone for EngineAnalyzer {
    fn clone(&self) -> Self {
        Self {
            manager: Arc::clone(&self.manager),
            state: Arc::clone(&self.state),
            infinite_stop_requested: Arc::clone(&self.infinite_stop_requested),
        }
    }
}
