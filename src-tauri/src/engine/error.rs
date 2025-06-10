use thiserror::Error;

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("USI engine error: {0}")]
    Usi(#[from] usi::Error),

    #[error("Engine not running")]
    NotRunning,

    #[error("Engine already running")]
    AlreadyRunning,

    #[error("Invalid engine path: {path}")]
    InvalidPath { path: String },

    #[error("Invalid position: {position}")]
    InvalidPosition { position: String },

    #[error("Option not found: {name}")]
    OptionNotFound { name: String },

    #[error("Invalid option value for {name}: {value}")]
    InvalidOptionValue { name: String, value: String },

    #[error("Analysis not started")]
    AnalysisNotStarted,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Channel communication error")]
    Channel,

    #[error("Engine communication timeout")]
    Timeout,

    #[error("Tauri Error")]
    TauriError(#[from] tauri::Error),

    #[error("Unknown error: {message}")]
    Unknown { message: String },
}

pub type EngineResult<T> = Result<T, EngineError>;
