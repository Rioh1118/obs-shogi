use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::{broadcast, mpsc, RwLock};

use super::error::{EngineError, EngineResult};
use super::types::*;

/// 解析制御コマンド
#[derive(Debug, Clone)]
pub enum AnalysisCommand {
    Start {
        position: String,
        options: AnalysisOptions,
    },
    Stop,
    Pause,
    Resume,
    UpdateOptions(AnalysisOptions),
}

/// 解析状態
#[derive(Debug, Clone, PartialEq)]
pub enum AnalysisState {
    Idle,
    Analyzing {
        position: String,
        start_time: SystemTime,
        options: AnalysisOptions,
    },
    Paused,
    Error {
        message: String,
    },
}

/// 解析オプション
#[derive(Debug, Clone, PartialEq)]
pub struct AnalysisOptions {
    pub depth: Option<u32>,
    pub time: Option<Duration>,
    pub nodes: Option<u64>,
    pub multi_pv: Option<u32>,
    pub hash_size: Option<u32>,
}

impl Default for AnalysisOptions {
    fn default() -> Self {
        Self {
            depth: None,
            time: None,
            nodes: None,
            multi_pv: Some(1),
            hash_size: None,
        }
    }
}

/// 解析イベント
#[derive(Debug, Clone)]
pub enum AnalysisEvent {
    Started {
        position: String,
        options: AnalysisOptions,
    },
    Update {
        result: AnalysisResult,
    },
    Completed {
        final_result: AnalysisResult,
        best_move: Option<String>,
    },
    Stopped,
    Error {
        message: String,
    },
}

// EngineManagerの仮実装
pub struct MockEngineManager;

impl MockEngineManager {
    pub async fn set_position(&self, _position: &str) -> EngineResult<()> {
        Ok(())
    }

    pub async fn start_thinking(&self) -> EngineResult<()> {
        Ok(())
    }

    pub async fn stop_thinking(&self) -> EngineResult<()> {
        Ok(())
    }

    pub async fn set_option(&self, _name: &str, _value: &str) -> EngineResult<()> {
        Ok(())
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<EngineEvent> {
        let (_tx, rx) = broadcast::channel(100);
        rx
    }
}

/// 解析マネージャー
pub struct AnalysisManager {
    command_tx: mpsc::Sender<AnalysisCommand>,
    event_tx: broadcast::Sender<AnalysisEvent>,
    #[allow(dead_code)]
    engine_manager: Arc<MockEngineManager>,
    state: Arc<RwLock<AnalysisState>>,
}

impl AnalysisManager {
    pub fn new(engine_manager: Arc<MockEngineManager>) -> EngineResult<Self> {
        let (command_tx, command_rx) = mpsc::channel(100);
        let (event_tx, _) = broadcast::channel(1000);
        let state = Arc::new(RwLock::new(AnalysisState::Idle));

        let manager = Self {
            command_tx,
            event_tx,
            engine_manager: engine_manager.clone(),
            state: state.clone(),
        };

        let mut worker = AnalysisWorker {
            command_rx,
            event_tx: manager.event_tx.clone(),
            engine_manager,
            state,
        };

        tokio::spawn(async move {
            if let Err(e) = worker.run().await {
                eprintln!("Analysis worker error: {}", e);
            }
        });

        Ok(manager)
    }

    pub async fn start_analysis(
        &self,
        position: &str,
        options: AnalysisOptions,
    ) -> EngineResult<()> {
        let command = AnalysisCommand::Start {
            position: position.to_string(),
            options,
        };

        self.command_tx
            .send(command)
            .await
            .map_err(|_| EngineError::Channel)?;

        Ok(())
    }

    pub async fn stop_analysis(&self) -> EngineResult<()> {
        self.command_tx
            .send(AnalysisCommand::Stop)
            .await
            .map_err(|_| EngineError::Channel)?;

        Ok(())
    }

    pub async fn pause_analysis(&self) -> EngineResult<()> {
        self.command_tx
            .send(AnalysisCommand::Pause)
            .await
            .map_err(|_| EngineError::Channel)?;

        Ok(())
    }

    pub async fn resume_analysis(&self) -> EngineResult<()> {
        self.command_tx
            .send(AnalysisCommand::Resume)
            .await
            .map_err(|_| EngineError::Channel)?;

        Ok(())
    }

    pub async fn get_state(&self) -> AnalysisState {
        self.state.read().await.clone()
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<AnalysisEvent> {
        self.event_tx.subscribe()
    }
}

struct AnalysisWorker {
    command_rx: mpsc::Receiver<AnalysisCommand>,
    event_tx: broadcast::Sender<AnalysisEvent>,
    engine_manager: Arc<MockEngineManager>,
    state: Arc<RwLock<AnalysisState>>,
}

impl AnalysisWorker {
    async fn run(&mut self) -> EngineResult<()> {
        let mut engine_events = self.engine_manager.subscribe_events();

        loop {
            tokio::select! {
                Some(command) = self.command_rx.recv() => {
                    if let Err(e) = self.handle_command(command).await {
                        self.emit_error(format!("Command error: {}", e)).await;
                    }
                }

                Ok(engine_event) = engine_events.recv() => {
                    if let Err(e) = self.handle_engine_event(engine_event).await {
                        self.emit_error(format!("Engine event error: {}", e)).await;
                    }
                }

                else => break,
            }
        }

        Ok(())
    }

    async fn handle_command(&mut self, command: AnalysisCommand) -> EngineResult<()> {
        match command {
            AnalysisCommand::Start { position, options } => {
                self.start_analysis(&position, options).await?;
            }
            AnalysisCommand::Stop => {
                self.stop_analysis().await?;
            }
            AnalysisCommand::Pause => {
                self.pause_analysis().await?;
            }
            AnalysisCommand::Resume => {
                self.resume_analysis().await?;
            }
            AnalysisCommand::UpdateOptions(options) => {
                self.update_options(options).await?;
            }
        }
        Ok(())
    }

    async fn start_analysis(
        &mut self,
        position: &str,
        options: AnalysisOptions,
    ) -> EngineResult<()> {
        let current_state = self.state.read().await.clone();
        if matches!(current_state, AnalysisState::Analyzing { .. }) {
            self.engine_manager.stop_thinking().await?;
        }

        self.engine_manager.set_position(position).await?;
        self.apply_analysis_options(&options).await?;
        self.engine_manager.start_thinking().await?;

        let new_state = AnalysisState::Analyzing {
            position: position.to_string(),
            start_time: SystemTime::now(),
            options: options.clone(),
        };
        *self.state.write().await = new_state;

        let event = AnalysisEvent::Started {
            position: position.to_string(),
            options,
        };
        let _ = self.event_tx.send(event);

        Ok(())
    }

    async fn stop_analysis(&mut self) -> EngineResult<()> {
        self.engine_manager.stop_thinking().await?;
        *self.state.write().await = AnalysisState::Idle;
        let _ = self.event_tx.send(AnalysisEvent::Stopped);
        Ok(())
    }

    async fn pause_analysis(&mut self) -> EngineResult<()> {
        let current_state = self.state.read().await.clone();
        if matches!(current_state, AnalysisState::Analyzing { .. }) {
            self.engine_manager.stop_thinking().await?;
            *self.state.write().await = AnalysisState::Paused;
        }
        Ok(())
    }

    async fn resume_analysis(&mut self) -> EngineResult<()> {
        let current_state = self.state.read().await.clone();
        if matches!(current_state, AnalysisState::Paused) {
            self.engine_manager.start_thinking().await?;
        }
        Ok(())
    }

    async fn update_options(&mut self, options: AnalysisOptions) -> EngineResult<()> {
        self.apply_analysis_options(&options).await?;
        Ok(())
    }

    async fn apply_analysis_options(&self, options: &AnalysisOptions) -> EngineResult<()> {
        if let Some(hash_size) = options.hash_size {
            self.engine_manager
                .set_option("Hash", &hash_size.to_string())
                .await?;
        }
        Ok(())
    }

    async fn handle_engine_event(&mut self, event: EngineEvent) -> EngineResult<()> {
        match event {
            EngineEvent::AnalysisUpdate { result } => {
                let analysis_event = AnalysisEvent::Update { result };
                let _ = self.event_tx.send(analysis_event);
            }
            EngineEvent::BestMove {
                best_move,
                ponder: _,
            } => {
                let final_result = AnalysisResult::empty();
                let analysis_event = AnalysisEvent::Completed {
                    final_result,
                    best_move: Some(best_move),
                };
                let _ = self.event_tx.send(analysis_event);
                *self.state.write().await = AnalysisState::Idle;
            }
            EngineEvent::Error { message } => {
                self.emit_error(message).await;
            }
            _ => {}
        }
        Ok(())
    }

    async fn emit_error(&mut self, message: String) {
        *self.state.write().await = AnalysisState::Error {
            message: message.clone(),
        };
        let _ = self.event_tx.send(AnalysisEvent::Error { message });
    }
}
