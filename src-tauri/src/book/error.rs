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
    /// 形式は読めるが、この形式の上限を超える大きさで開けない。
    /// `InvalidContent` に混ぜると「壊れている」と読まれ、取得し直すという
    /// 効かない復帰操作へ誘導することになる
    TooLarge,
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
    visible_and_truncated(raw, MAX_PATH_CHARS)
}

/// message とログに載せる文字列を、見える形にして予算まで切る。
///
/// **予算ごとに書き分けない。** パスと引用は上限が違うだけで、やることは同じ。
/// 分けて書くと、片方だけ直した状態が生まれる。
///
/// 制御文字を潰すのは、`\n` を含む値がそのまま通ると1回の `log!` が2行になり、
/// 後ろの行が本物のコマンドログと見分けが付かなくなるため（報告を受けてログから
/// 切り分ける、というこの層の目的が直接壊れる）。message では、引用が
/// 「どこも壊れて見えない」と利用者が正しいファイルを拒否されたと判断して、
/// 案内された復帰操作を何度も繰り返すことになる。
///
/// **切ってから組む。** 先に `replace` で全体を作ると、120 字に切る前に入力全体
/// （制御文字だらけなら3倍）を確保する。`to_book_key` の入力はコマンド境界から
/// 来る任意長の文字列で、しかも `spawn_blocking` の外を通る。
fn visible_and_truncated(raw: &str, budget: usize) -> String {
    let mut out: String = raw
        .chars()
        .take(budget)
        .map(|c| if c.is_control() { '\u{2423}' } else { c })
        .collect();
    if out.chars().count() < raw.chars().count() {
        out.push('…');
    }
    out
}

/// message に載せる引用の上限。
///
/// 「持駒が無い: <局面>」のような理由が読み取れる長さで、なおかつ失敗1件が
/// ログ（200KB でローテート）の予算を食い潰さない上限として選んだ。
const MESSAGE_EXCERPT_CHARS: usize = 120;

/// message に載せる引用。前後の空白は落とし、長さを打ち切る。
///
/// **定跡ファイルの中身を message へ載せるときは、必ずこれを通すこと。**
/// パス用の [`truncate_path`] は上限が [`MAX_PATH_CHARS`] 字で、
/// 引用の予算（120字）の 34 倍ある。1行の長さは読み込みの側が頭打ちにするが、
/// その上限もこの予算の 34 倍なので、そちらを使うと失敗1回でログの予算を
/// 食い潰す。
///
/// 制御文字は見える形に置き換える（理由は [`visible_and_truncated`]）。
/// タブで欄を区切った定跡がその形（`8c8d\tnone\t1\t1\t1` が
/// `8c8d none 1 1 1` に見える）。
pub(crate) fn excerpt(input: &str) -> String {
    truncate_for_message(input.trim())
}

/// message に載せる引用を打ち切る。
pub(crate) fn truncate_for_message(excerpt: &str) -> String {
    visible_and_truncated(excerpt, MESSAGE_EXCERPT_CHARS)
}

/// 利用者に見せる大きさ。
///
/// **10進で数える。** 上限そのものは 2 の冪で持っているが、利用者が見比べる
/// 相手は Finder / エクスプローラのファイル情報で、そちらは 10 進。
/// 1024 で割った値に `MB` と書くと、同じファイルの数字が食い違う。
///
/// **桁で単位を選ぶ。** 行長（4 KiB）から展開の上限（7 GiB）まで同じ関数に
/// 通すので、`MB` 固定だと 4096 バイトが `0.0MB` になって上限を1つも伝えない。
///
/// パスの打ち切り（[`MAX_PATH_CHARS`]）と引用の打ち切り（[`MESSAGE_EXCERPT_CHARS`]）と
/// 同じ場所に置く。どれも「message に載せるときの決まり」で、形式の事実ではない。
pub(crate) fn format_size(bytes: u64) -> String {
    const KB: f64 = 1_000.0;
    const MB: f64 = 1_000_000.0;
    const GB: f64 = 1_000_000_000.0;

    let value = bytes as f64;
    if value >= GB {
        format!("{:.1}GB", value / GB)
    } else if value >= MB {
        format!("{:.1}MB", value / MB)
    } else {
        format!("{:.1}KB", value / KB)
    }
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

    /// 引用は予算に収まること。制御文字を含む入力でも同じ。
    ///
    /// **確保の順序はここでは見られない。** 切ってから組んでも先に全体を
    /// 置き換えても出力は同じで、違うのは確保量だけ。順序を守っているのは
    /// [`visible_and_truncated`] に両方を通す形そのもので、テストではない。
    #[test]
    fn an_excerpt_stays_within_its_budget() {
        for input in ["\u{7}".repeat(10_000), "a".repeat(10_000)] {
            let out = excerpt(&input);
            // 予算 + 打ち切りの跡
            assert_eq!(out.chars().count(), MESSAGE_EXCERPT_CHARS + 1, "{out:.40}");
            assert!(out.ends_with('…'), "{out:.40}");
        }
    }

    /// 制御文字は見える形にする。タブで欄を区切った定跡の引用が
    /// 「どこも壊れて見えない」と、利用者は正しいファイルを拒否されたと判断する。
    #[test]
    fn an_excerpt_shows_control_characters() {
        let out = excerpt("8c8d\tnone\t1");

        assert!(!out.contains('\t'), "{out}");
        assert_eq!(out.matches('\u{2423}').count(), 2, "{out}");
    }

    /// 予算に収まる入力には打ち切りの跡を付けない。
    #[test]
    fn a_short_excerpt_is_not_marked_as_truncated() {
        assert_eq!(excerpt("  7g7f  "), "7g7f");
    }
}
