use serde::Serialize;
use std::io;

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub enum FsErrorCode {
    AlreadyExists,
    NotFound,
    InvalidName,
    InvalidPath,
    InvalidType,
    InvalidExtension,
    InvalidDestination,
    PermissionDenied,
    Io,
    Unknown,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsError {
    pub code: FsErrorCode,
    pub message: String,
    pub path: Option<String>,
    pub existing_path: Option<String>,
}

impl FsError {
    pub fn new(code: FsErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
            existing_path: None,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn with_existing_path(mut self, path: impl Into<String>) -> Self {
        self.existing_path = Some(path.into());
        self
    }
}

impl From<io::Error> for FsError {
    fn from(value: io::Error) -> Self {
        let code = match value.kind() {
            io::ErrorKind::AlreadyExists => FsErrorCode::AlreadyExists,
            io::ErrorKind::NotFound => FsErrorCode::NotFound,
            io::ErrorKind::PermissionDenied => FsErrorCode::PermissionDenied,
            _ => FsErrorCode::Io,
        };

        FsError::new(code, value.to_string())
    }
}
