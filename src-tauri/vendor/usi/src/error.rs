use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("illegal USI command syntax")]
    IllegalSyntax,

    #[error("illegal USI command syntax")]
    IllegalNumberFormat(#[from] std::num::ParseIntError),

    #[error("the engine already started listening")]
    IllegalOperation,

    #[error("IO error occurred when communicating with the engine")]
    EngineIo(#[from] std::io::Error),

    #[error("An error occurred inside the external handler")]
    HandlerError(#[from] Box<dyn std::error::Error + Send + Sync>),
}
