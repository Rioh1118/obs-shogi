use serde::Serialize;
use std::fmt;
use std::io;

/// フロントで分岐できる粒度の失敗種別。
///
/// メッセージ文字列で分岐させないために、`file_system::FsError` と同じ形を取る。
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BookErrorCode {
    /// 定跡ファイルが存在しない
    NotFound,
    /// 拡張子から形式を判別できない
    UnknownExtension,
    /// 形式は判別できたが reader をまだ持っていない
    UnsupportedFormat,
    /// ファイルの中身が形式の規定を満たさない
    InvalidContent,
    /// 閉じた、あるいは一度も開かれていないハンドル
    InvalidHandle,
    /// 局面の指定が SFEN として読めない
    InvalidSfen,
    Io,
    Unknown,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookError {
    pub code: BookErrorCode,
    pub message: String,
    pub path: Option<String>,
}

impl BookError {
    pub fn new(code: BookErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }
}

impl fmt::Display for BookError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.path {
            Some(path) => write!(f, "{:?}: {} ({path})", self.code, self.message),
            None => write!(f, "{:?}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for BookError {}

impl From<io::Error> for BookError {
    fn from(value: io::Error) -> Self {
        let code = match value.kind() {
            io::ErrorKind::NotFound => BookErrorCode::NotFound,
            _ => BookErrorCode::Io,
        };

        BookError::new(code, value.to_string())
    }
}
