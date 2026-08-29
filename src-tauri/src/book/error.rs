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
    /// 存在するが読む権限が無い
    PermissionDenied,
    /// 指されたものがファイルではない（ディレクトリなど）
    InvalidType,
    /// パスが定跡の指定として成立していない
    InvalidPath,
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
    /// 読み書きそのものが失敗した
    Io,
    /// 上のどれにも当てはまらない。フロントは再試行しか案内できない
    Unknown,
}

/// 定跡まわりの失敗。Tauri コマンドの `Err` としてそのままフロントへ渡る。
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookError {
    pub code: BookErrorCode,
    /// 利用者に見せる説明。分岐には使わない
    pub message: String,
    /// どのファイルで起きたか。複数の定跡を開いているときに要る
    pub path: Option<String>,
}

impl BookError {
    /// パスに紐づかない失敗を作る。ファイルが絡むなら [`BookError::with_path`] を続ける。
    pub fn new(code: BookErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    /// どのファイルで起きたかを添える。
    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    /// io の失敗に、どのファイルで起きたかを添える。
    ///
    /// `?` 越しの [`From<io::Error>`] は path を埋められないので、複数の定跡を
    /// 開いているときに「どれが死んだのか」がフロントに伝わらない。
    pub fn from_io(err: io::Error, path: impl Into<String>) -> Self {
        Self::from(err).with_path(path)
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
        // 案内は日本語で、次に何をすればよいかまで書く。OS の原文は後ろに残す。
        // message はログにもそのまま出るので、ここから落とすと切り分けができなくなる。
        let (code, guidance) = match value.kind() {
            io::ErrorKind::NotFound => (BookErrorCode::NotFound, "定跡ファイルが見つからない"),
            io::ErrorKind::PermissionDenied => (
                BookErrorCode::PermissionDenied,
                "定跡ファイルを読む権限が無い。システム設定でこのアプリにアクセスを許可するか、別の場所にコピーすること",
            ),
            _ => (BookErrorCode::Io, "定跡ファイルを読めない"),
        };

        BookError::new(code, format!("{guidance}（{value}）"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn io_error_kinds_map_to_their_own_codes() {
        let cases = [
            (io::ErrorKind::NotFound, BookErrorCode::NotFound),
            (
                io::ErrorKind::PermissionDenied,
                BookErrorCode::PermissionDenied,
            ),
            (io::ErrorKind::UnexpectedEof, BookErrorCode::Io),
        ];

        for (kind, expected) in cases {
            let err = BookError::from(io::Error::new(kind, "boom"));
            assert_eq!(err.code, expected, "kind={kind:?}");
        }
    }

    #[test]
    fn from_io_keeps_the_path() {
        let err = BookError::from_io(
            io::Error::new(io::ErrorKind::PermissionDenied, "boom"),
            "/books/a.db",
        );
        assert_eq!(err.code, BookErrorCode::PermissionDenied);
        assert_eq!(err.path.as_deref(), Some("/books/a.db"));
    }
}
