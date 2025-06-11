use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};
use usi::{
    EngineCommand, GuiCommand, IdParams, InfoParams, OptionKind, OptionParams, ScoreKind,
    ThinkParams, UsiEngineHandler,
};

use crate::engine::types::*;

pub struct UsiAnalysisEngine {
    handler: UsiEngineHandler,
    result_sender: Option<mpsc::UnboundedSender<AnalysisResult>>,
    is_analyzing: Arc<Mutex<bool>>,
}

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("Engine Startup failed:{0}")]
    StartupFailed(String),
    #[error("Communication failed: {0}")]
    CommunicationFailed(String),
    #[error("Analysis failed: {0}")]
    AnalysisFailed(String),
}

#[derive(Error, Debug)]
pub enum HookError {
    #[error("Channel send error")]
    ChannelSendError,
    #[error("Analysis processing error: {0}")]
    ProcessingError(String),
}

#[derive(Debug, Clone)]
enum EngineResponse {
    Id(IdParams),
    Option(OptionParams),
    UsiOk,
}

impl UsiAnalysisEngine {
    /// エンジンを起動し初期化
    pub async fn new(engine_path: &str, work_dir: &str) -> Result<Self, EngineError> {
        let handler = UsiEngineHandler::spawn(engine_path, work_dir)
            .map_err(|e| EngineError::StartupFailed(e.to_string()))?;

        let mut engine = Self {
            handler,
            result_sender: None,
            is_analyzing: Arc::new(Mutex::new(false)),
        };
        engine.initialize().await?;

        Ok(engine)
    }

    /// エンジンを起動し、オプション情報も取得
    pub async fn new_with_options(
        engine_path: &str,
        work_dir: &str,
    ) -> Result<(Self, EngineInfo), EngineError> {
        let handler = UsiEngineHandler::spawn(engine_path, work_dir)
            .map_err(|e| EngineError::StartupFailed(e.to_string()))?;

        let mut engine = Self {
            handler,
            result_sender: None,
            is_analyzing: Arc::new(Mutex::new(false)),
        };

        let engine_info = engine.collect_engine_info().await?;

        engine.complete_initialization().await?;
        Ok((engine, engine_info))
    }

    /// USI初期化プロセス
    async fn initialize(&mut self) -> Result<(), EngineError> {
        // 1. USIコマンド送信
        self.handler
            .send_command(&GuiCommand::Usi)
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;

        // 2. エンジン情報取得(id name, id author, option, usiok)
        let _info = self
            .handler
            .get_info()
            .map_err(|e| EngineError::StartupFailed(e.to_string()))?;

        // 3. エンジンの準備完了を待つ
        self.handler
            .prepare()
            .map_err(|e| EngineError::StartupFailed(e.to_string()))?;

        Ok(())
    }

    /// エンジン情報とオプションを収集
    async fn collect_engine_info(&mut self) -> Result<EngineInfo, EngineError> {
        let (tx, mut rx) = mpsc::unbounded_channel();

        // listenでエンジンからの応答を監視
        let tx_clone = tx.clone();
        let listen_result = self.handler.listen(move |output| -> Result<(), HookError> {
            if let Some(cmd) = output.response() {
                match cmd {
                    EngineCommand::Id(id_params) => {
                        tx_clone
                            .send(EngineResponse::Id(id_params.clone()))
                            .map_err(|_| HookError::ChannelSendError)?;
                    }
                    EngineCommand::Option(option_params) => {
                        tx_clone
                            .send(EngineResponse::Option(option_params.clone()))
                            .map_err(|_| HookError::ChannelSendError)?;
                    }
                    EngineCommand::UsiOk => {
                        tx_clone
                            .send(EngineResponse::UsiOk)
                            .map_err(|_| HookError::ChannelSendError)?;

                        return Err(HookError::ProcessingError(
                            "collection complete".to_string(),
                        ));
                    }
                    _ => {}
                }
            }
            Ok(())
        });

        // USIコマンドを送信
        self.handler
            .send_command(&GuiCommand::Usi)
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;

        // 応答を収集
        let mut name = String::new();
        let mut author = String::new();
        let mut options = Vec::new();

        // タイムアウト付きで応答を待つ
        let timeout = Duration::from_secs(10);
        let start_time = std::time::Instant::now();

        loop {
            if start_time.elapsed() > timeout {
                return Err(EngineError::StartupFailed(
                    "Timeout waiting for engine response".to_string(),
                ));
            }

            match tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
                Ok(Some(response)) => {
                    match response {
                        EngineResponse::Id(id_params) => match id_params {
                            IdParams::Name(n) => name = n,
                            IdParams::Author(a) => author = a,
                        },
                        EngineResponse::Option(option_params) => {
                            let engine_option = Self::convert_option_params(&option_params);
                            options.push(engine_option);
                        }
                        EngineResponse::UsiOk => {
                            // 収集完了
                            break;
                        }
                    }
                }
                Ok(None) => {
                    return Err(EngineError::CommunicationFailed(
                        "Channel closed".to_string(),
                    ));
                }
                Err(_) => {
                    // タイムアウト - 続行
                    continue;
                }
            }
        }

        // listenを停止
        if let Err(e) = listen_result {
            // 正常終了（Collection complete）以外はエラー
            if !e.to_string().contains("Collection complete") {
                return Err(EngineError::AnalysisFailed(e.to_string()));
            }
        }

        Ok(EngineInfo {
            name,
            author,
            options,
        })
    }
    /// 初期化を完了する
    async fn complete_initialization(&mut self) -> Result<(), EngineError> {
        // エンジンの準備完了を待つ
        self.handler
            .prepare()
            .map_err(|e| EngineError::StartupFailed(e.to_string()))?;

        Ok(())
    }

    /// OptionParamsをEngineOptionに変換
    fn convert_option_params(params: &OptionParams) -> EngineOption {
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

    /// エンジン設定を適用
    pub async fn apply_settings(&mut self, settings: &EngineSettings) -> Result<(), EngineError> {
        for (name, value) in &settings.options {
            self.handler
                .send_command(&GuiCommand::SetOption(name.clone(), Some(value.clone())))
                .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;
        }
        Ok(())
    }

    /// エンジンの準備完了を確認
    pub async fn ensure_ready(&mut self) -> Result<(), EngineError> {
        self.handler
            .send_command(&GuiCommand::IsReady)
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;

        // readyokの応答を待つ場合は、必要に応じて実装
        Ok(())
    }

    /// 無制限解析開始
    pub async fn start_infinite_analysis(
        &mut self,
        position: &str,
        result_sender: mpsc::UnboundedSender<AnalysisResult>,
    ) -> Result<(), EngineError> {
        // すでに解析中なら停止
        if *self.is_analyzing.lock().await {
            self.stop_analysis().await?;
        }

        self.result_sender = Some(result_sender);
        *self.is_analyzing.lock().await = true;

        // 1. 局面設定
        self.handler
            .send_command(&GuiCommand::Position(position.to_string()))
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;

        // 2. 無制限解析開始
        self.handler
            .send_command(&GuiCommand::Go(ThinkParams::new().infinite()))
            .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;

        // 3. 解析監視開始
        self.start_monitoring().await?;

        Ok(())
    }

    /// 解析停止
    pub async fn stop_analysis(&mut self) -> Result<(), EngineError> {
        if *self.is_analyzing.lock().await {
            self.handler
                .send_command(&GuiCommand::Stop)
                .map_err(|e| EngineError::CommunicationFailed(e.to_string()))?;
            *self.is_analyzing.lock().await = false;
        }
        Ok(())
    }

    /// エンジンからの情報監視
    async fn start_monitoring(&mut self) -> Result<(), EngineError> {
        let is_analyzing = Arc::clone(&self.is_analyzing);
        let result_sender = self.result_sender.clone();

        self.handler
            .listen(move |output| -> Result<(), HookError> {
                if let Some(cmd) = output.response() {
                    match cmd {
                        EngineCommand::Info(info_list) => {
                            let analysis_result = Self::parse_info_to_analysis(info_list.to_vec());
                            if let Some(sender) = &result_sender {
                                sender
                                    .send(analysis_result)
                                    .map_err(|_| HookError::ChannelSendError)?;
                            }
                        }
                        EngineCommand::BestMove(_) => {
                            // infinite解析が終了（stopによる）
                            let is_analyzing_clone = Arc::clone(&is_analyzing);
                            tokio::spawn(async move {
                                *is_analyzing_clone.lock().await = false;
                            });
                        }
                        _ => {}
                    }
                }
                Ok(())
            })
            .map_err(|e| EngineError::AnalysisFailed(e.to_string()))?;

        Ok(())
    }

    /// InfoParamsをAnalysisResultに変換
    fn parse_info_to_analysis(info_list: Vec<InfoParams>) -> AnalysisResult {
        let mut result = AnalysisResult::default();
        let mut current_multipv: Option<i32> = None;

        for info in info_list {
            match info {
                InfoParams::Score(value, kind) => {
                    let eval_kind = match kind {
                        ScoreKind::CpExact | ScoreKind::CpLowerbound | ScoreKind::CpUpperbound => {
                            EvaluationKind::Centipawn
                        }
                        ScoreKind::MateExact
                        | ScoreKind::MateLowerbound
                        | ScoreKind::MateUpperbound => match value {
                            0 => EvaluationKind::MateUnknown(true),
                            _ => EvaluationKind::MateInMoves(value),
                        },
                        ScoreKind::MateSignOnly => EvaluationKind::MateUnknown(value >= 0),
                    };
                    result.evaluation = Some(Evaluation {
                        value,
                        kind: eval_kind,
                    });
                }

                InfoParams::Pv(moves) => {
                    let pv = PrincipalVariation {
                        line_number: current_multipv,
                        moves,
                        evaluation: result.evaluation.clone(),
                    };
                    result.principal_variations.push(pv);
                    current_multipv = None; // リセット
                }

                InfoParams::MultiPv(line) => {
                    current_multipv = Some(line);
                }

                InfoParams::Depth(depth, seldepth) => {
                    result.depth_info = Some(DepthInfo {
                        depth,
                        selective_depth: seldepth,
                    });
                }

                InfoParams::Nodes(nodes) => {
                    if result.search_stats.is_none() {
                        result.search_stats = Some(SearchStats::default());
                    }
                    if let Some(stats) = &mut result.search_stats {
                        stats.nodes = Some(nodes);
                    }
                }

                InfoParams::Nps(nps) => {
                    if result.search_stats.is_none() {
                        result.search_stats = Some(SearchStats::default());
                    }
                    if let Some(stats) = &mut result.search_stats {
                        stats.nps = Some(nps);
                    }
                }

                InfoParams::HashFull(hash_full) => {
                    if result.search_stats.is_none() {
                        result.search_stats = Some(SearchStats::default());
                    }
                    if let Some(stats) = &mut result.search_stats {
                        stats.hash_full = Some(hash_full);
                    }
                }

                InfoParams::Time(duration) => {
                    if result.search_stats.is_none() {
                        result.search_stats = Some(SearchStats::default());
                    }
                    if let Some(stats) = &mut result.search_stats {
                        stats.time_elapsed = Some(duration);
                    }
                }

                _ => {} // その他のInfoは無視
            }
        }

        result
    }
}
