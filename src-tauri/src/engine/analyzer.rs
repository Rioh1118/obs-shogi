use crate::engine::utils::{apply_info_params, get_depth_of_rank, LogThrottle};

use super::protocol::UsiProtocol;
use super::registry::{EngineId, EngineRegistry};
use super::types::*;
use super::USI_OK_TIMEOUT;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex, RwLock};
use usi::{EngineCommand, GuiCommand, ThinkParams};

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
///
/// 解析が使うエンジンは、対局が使うものと同じ台帳（`EngineRegistry`）に載る。
/// ここが持つのは「そのうちどれが解析用か」だけ。
pub struct EngineAnalyzer {
    registry: Arc<EngineRegistry>,
    engine_id: Arc<RwLock<Option<EngineId>>>,
    state: Arc<RwLock<AnalyzerState>>,
    infinite_stop_requested: Arc<Mutex<Option<Arc<AtomicBool>>>>,
}

#[derive(Debug, Clone, Default)]
struct AnalyzerState {
    current_position: Option<String>,
    last_result: Option<AnalysisResult>,
    analysis_count: u64,
}

enum StreamMode {
    Infinite(Arc<AtomicBool>),
    #[allow(dead_code)]
    Finite,
}

impl EngineAnalyzer {
    pub fn new(registry: Arc<EngineRegistry>) -> Self {
        Self {
            registry,
            engine_id: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(AnalyzerState::default())),
            infinite_stop_requested: Arc::new(Mutex::new(None)),
        }
    }

    /// 解析用のエンジンを起動する。既に持っていれば先に落とす。
    pub async fn initialize_engine(
        &self,
        engine_path: String,
        working_dir: Option<String>,
    ) -> Result<(), EngineError> {
        self.shutdown().await?;

        let process = self
            .registry
            .spawn(&engine_path, working_dir.as_deref(), USI_OK_TIMEOUT)
            .await?;

        *self.engine_id.write().await = Some(process.id.clone());
        Ok(())
    }

    /// 解析用エンジンのプロトコル層。起動していなければ `NotInitialized`。
    async fn protocol(&self) -> Result<Arc<UsiProtocol>, EngineError> {
        let id = self
            .engine_id
            .read()
            .await
            .clone()
            .ok_or_else(|| EngineError::NotInitialized("Engine not initialized".to_string()))?;

        // 台帳から消えている＝落とされた後。ID を持っているだけでは起動を意味しない
        let process = self.registry.get(&id).await.ok_or_else(|| {
            EngineError::NotInitialized("Engine is no longer running".to_string())
        })?;

        Ok(process.protocol())
    }

    pub async fn apply_settings(&self, settings: EngineSettings) -> Result<(), EngineError> {
        let protocol = self.protocol().await?;

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
        let id = self.engine_id.write().await.take();
        if let Some(id) = id {
            self.registry.shutdown(&id).await;
        }
        Ok(())
    }

    pub async fn get_engine_info(&self) -> Result<EngineInfo, EngineError> {
        let protocol = self.protocol().await?;
        protocol.get_engine_info(USI_OK_TIMEOUT).await
    }

    /// 局面を設定
    pub async fn set_position(&self, position: &str) -> Result<(), EngineError> {
        // USI プロトコルは行指向なので、position 文字列への改行注入を拒否する
        if contains_usi_breaking_char(position) {
            return Err(EngineError::CommunicationFailed(
                "position string contains forbidden control character".to_string(),
            ));
        }

        let protocol = self.protocol().await?;

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
        log::debug!(target: LOGT, "analysis.infinite.start: requested");

        let stop_flag = Arc::new(AtomicBool::new(false));
        *self.infinite_stop_requested.lock().await = Some(stop_flag.clone());

        let protocol = self.protocol().await?;

        // channel
        let (result_tx, result_rx) = mpsc::unbounded_channel();
        let (raw_tx, raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!(
            "infinite_analysis_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        log::debug!(
            target: LOGT,
            "analysis.infinite: register_listener id={}",
            listener_id
        );

        if let Err(e) = protocol
            .register_listener(listener_id.clone(), raw_tx)
            .await
        {
            log::error!(
                target: LOGT,
                "analysis.infinite: register_listener failed: {:?}",
                e
            );
            return Err(e);
        }

        log::debug!(target: LOGT, "analysis.infinite: send_command go=infinite");
        let go_command = GuiCommand::Go(ThinkParams::new().infinite());

        if let Err(e) = protocol.send_command(&go_command).await {
            log::error!(
                target: LOGT,
                "analysis.infinite: send_command failed: {:?}",
                e
            );
            let _ = protocol.remove_listener(&listener_id).await;
            return Err(e);
        }

        // 結果処理タスク開始前にログ
        log::info!(
            target: LOGT,
            "analysis.infinite.started listener_id={}",
            listener_id
        );

        // 結果処理タスク
        let state_clone = Arc::clone(&self.state);
        let protocol_for_task = protocol.clone();
        let listener_id_for_task = listener_id.clone();

        tokio::spawn(async move {
            log::debug!(
                target: LOGT,
                "analysis.infinite.stream: start listener_id={}",
                listener_id_for_task
            );
            Self::process_analysis_stream(
                raw_rx,
                result_tx,
                state_clone,
                StreamMode::Infinite(stop_flag),
            )
            .await;

            protocol_for_task
                .remove_listener(&listener_id_for_task)
                .await;
            log::debug!(
                target: LOGT,
                "analysis.infinite.stream: end listener_id={}",
                listener_id_for_task
            );
        });

        Ok(result_rx)
    }

    /// 固定時間解析
    pub async fn analyze_with_time(
        &self,
        time_limit: Duration,
    ) -> Result<AnalysisResult, EngineError> {
        let protocol = self.protocol().await?;

        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!("timed_analysis_{}", now_nanos());

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
        let protocol = self.protocol().await?;

        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();

        let listener_id = format!("depth_analysis_{}", now_nanos());

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

    /// 解析停止。
    ///
    /// **エンジンが既に居なくても成功にする。** 要求は「止まっていること」で、
    /// 落ちているならその要求は満たせている。`Err` を返すと、後片付けの途中に
    /// 置かれた呼び出し（`stop_all_sessions`）が `?` で折れて、
    /// その先の台帳の掃除まで走らなくなる
    pub async fn stop_analysis(&self) -> Result<(), EngineError> {
        let protocol = match self.protocol().await {
            Ok(protocol) => protocol,
            Err(EngineError::NotInitialized(reason)) => {
                log::debug!(target: LOGT, "stop_analysis: nothing to stop ({reason})");
                return Ok(());
            }
            Err(e) => return Err(e),
        };

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

    // === 内部ヘルパーメソッド ===

    /// 分析ストリーム処理（無限解析用）
    async fn process_analysis_stream(
        mut raw_rx: mpsc::UnboundedReceiver<EngineCommand>,
        result_tx: mpsc::UnboundedSender<AnalysisResult>,
        #[allow(unused_variables)] state: Arc<RwLock<AnalyzerState>>,
        mode: StreamMode,
    ) {
        log::debug!(target: LOGT, "stream: start");

        let mut current_result = AnalysisResult::default();
        let mut processed: u64 = 0;

        let mut stale_bestmove_warn = LogThrottle::new(Duration::from_secs(5));

        while let Some(cmd) = raw_rx.recv().await {
            processed += 1;

            match cmd {
                EngineCommand::Info(info_params) => {
                    apply_info_params(&info_params, &mut current_result);
                    // 更新された結果を送信
                    if result_tx.send(current_result.clone()).is_err() {
                        log::debug!(target: LOGT, "stream: result channel closed");
                        break;
                    }
                }
                EngineCommand::Checkmate(checkmate_params) => {
                    Self::process_checkmate(&checkmate_params, &mut current_result);

                    log::info!(target: LOGT, "stream: checkmate received");
                    let _ = result_tx.send(current_result.clone());
                }

                EngineCommand::BestMove(_) => {
                    match &mode {
                        StreamMode::Finite => {
                            let _ = result_tx.send(current_result.clone());
                            break;
                        }
                        StreamMode::Infinite(stop_flag) => {
                            // stop してないのに bestmove が来たらstaleの可能性
                            if !stop_flag.load(Ordering::SeqCst) {
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
                    }
                }
                _ => {}
            }
        }
        {
            let mut st = state.write().await;
            st.last_result = Some(current_result);
            st.analysis_count = st.analysis_count.wrapping_add(1);
        }

        log::debug!(target: LOGT, "stream: end processed={}", processed);
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
                        apply_info_params(&info_params, &mut result);
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
                            apply_info_params(&info_params, &mut result);

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
            registry: Arc::clone(&self.registry),
            engine_id: Arc::clone(&self.engine_id),
            state: Arc::clone(&self.state),
            infinite_stop_requested: Arc::clone(&self.infinite_stop_requested),
        }
    }
}
