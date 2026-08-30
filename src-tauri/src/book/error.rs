use serde::Serialize;
use std::fmt;
use std::io;

/// フロントで分岐できる粒度の失敗種別。
///
/// メッセージ文字列で分岐させないために、`file_system::FsError` と同じ形を取る。
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BookErrorCode {
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
    /// 閉じた、あるいは一度も開かれていないハンドル。
    /// 復帰導線は操作によって変わるので message に載せてある
    /// （引くなら開き直す、閉じるなら何もしなくてよい）。
    /// 孤児のハンドルは `list_books` で拾える
    InvalidHandle,
    /// 局面の指定が SFEN として読めない
    InvalidSfen,
    /// 読み書きそのものが失敗した
    Io,
    /// 上のどれにも当てはまらない。フロントは再試行しか案内できない
    Unknown,
}

/// 定跡まわりの失敗。Tauri コマンドの `Err` としてそのままフロントへ渡る。
///
/// フィールドは private。`path` の打ち切りは [`BookError::with_path`] が唯一の関門で、
/// 構造体リテラルで組み立てられると迂回できてしまう。
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookError {
    code: BookErrorCode,
    /// 利用者に見せる説明。分岐には使わない
    message: String,
    /// どのファイルで起きたか。複数の定跡を開いているときに要る
    path: Option<String>,
}

impl BookError {
    /// パスに紐づかない失敗を作る。ファイルが絡むなら [`BookError::with_path`] を続ける。
    pub(crate) fn new(code: BookErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }

    pub(crate) fn code(&self) -> BookErrorCode {
        self.code
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }

    pub(crate) fn path(&self) -> Option<&str> {
        self.path.as_deref()
    }

    /// どのファイルで起きたかを添える。
    ///
    /// ここで打ち切る。載せるパスはコマンド境界から来る任意長の文字列で、
    /// `Display` がこれを含めてログ（200KB でローテート）へ出る。呼び出し側で
    /// 打ち切る形にすると、経路が増えるたびに取り残す。
    pub(crate) fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(truncate_path(&path.into()));
        self
    }

    /// io の失敗に、どのファイルで起きたかを添える。
    ///
    /// `?` 越しの [`From<io::Error>`] は path を埋められないので、複数の定跡を
    /// 開いているときに「どれが死んだのか」がフロントに伝わらない。
    pub(crate) fn from_io(err: io::Error, path: impl Into<String>) -> Self {
        Self::from(err).with_path(path)
    }
}

/// エラーに載せるパスの上限。
///
/// 出荷対象で最も長いのは Windows の長パス（32,767 UTF-16 単位）。全部を載せても
/// ログの役に立たないのでここで切る。Linux の `PATH_MAX`（4096 バイト）以内の
/// パスは丸ごと載る。**弾くための値ではない。**
pub(crate) const MAX_PATH_CHARS: usize = 4096;

/// エラーやログに載せるパスを打ち切る。切れていることが分かるように印を付ける。
pub(crate) fn truncate_path(raw: &str) -> String {
    let mut out: String = raw.chars().take(MAX_PATH_CHARS).collect();
    if out.chars().count() < raw.chars().count() {
        out.push('…');
    }
    out
}

impl fmt::Display for BookError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.path() {
            Some(path) => write!(f, "{:?}: {} ({path})", self.code(), self.message()),
            None => write!(f, "{:?}: {}", self.code(), self.message()),
        }
    }
}

impl std::error::Error for BookError {}

impl From<io::Error> for BookError {
    fn from(value: io::Error) -> Self {
        // 案内は日本語で、次に何をすればよいかまで書く。OS の原文は後ろに残す。
        // message はログにもそのまま出るので、ここから落とすと切り分けができなくなる。
        let (code, guidance) = match value.kind() {
            io::ErrorKind::NotFound => (
                BookErrorCode::NotFound,
                "定跡ファイルが見つからない。外付けなら接続を確かめ、移動したなら選び直すこと",
            ),
            io::ErrorKind::PermissionDenied => (
                BookErrorCode::PermissionDenied,
                "定跡ファイルを読む権限が無い。システム設定でこのアプリにアクセスを許可するか、別の場所にコピーすること",
            ),
            _ => (
                BookErrorCode::Io,
                "定跡ファイルを読めない。開き直しても直らなければ、定跡を取得し直すこと",
            ),
        };

        BookError::new(code, format!("{guidance}（{value}）"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 種別だけを見ると、案内文を空にしても緑のまま通る。
    /// どの kind でも「次に何をすればよいか」が書かれていること。
    #[test]
    fn io_errors_tell_the_user_what_to_do_next() {
        for kind in [
            io::ErrorKind::NotFound,
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::UnexpectedEof,
        ] {
            let err = BookError::from(io::Error::new(kind, "boom"));
            assert!(
                err.message().contains("こと"),
                "kind={kind:?} message={}",
                err.message()
            );
        }
    }

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
            assert_eq!(err.code(), expected, "kind={kind:?}");
        }
    }

    #[test]
    fn from_io_keeps_the_path() {
        let err = BookError::from_io(
            io::Error::new(io::ErrorKind::PermissionDenied, "boom"),
            "/books/a.db",
        );
        assert_eq!(err.code(), BookErrorCode::PermissionDenied);
        assert_eq!(err.path(), Some("/books/a.db"));
    }
}
