use crate::book::error::{BookError, BookErrorCode};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 開いている定跡を指す識別子。一度配ったものは close 後も配り直さない。
pub type BookHandle = u64;

/// 定跡ファイルの形式。判別は拡張子で行う（[`BookFormat::from_path`]）。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BookFormat {
    /// やねうら王テキスト定跡 `.db`
    YaneuraouDb,
    /// Apery バイナリ定跡 `.bin`
    AperyBin,
    /// ShogiGUI 定跡 `.sbk`
    ShogiGuiSbk,
    /// やねうら王バイナリ定跡 `.ybb`
    YaneuraouYbb,
}

impl BookFormat {
    /// 利用者に見せる名前。enum のバリアント名をそのまま出さないため。
    pub(crate) fn display_name(self) -> &'static str {
        match self {
            BookFormat::YaneuraouDb => "やねうら王テキスト定跡 (.db)",
            BookFormat::AperyBin => "Apery 定跡 (.bin)",
            BookFormat::ShogiGuiSbk => "ShogiGUI 定跡 (.sbk)",
            BookFormat::YaneuraouYbb => "やねうら王バイナリ定跡 (.ybb)",
        }
    }

    /// 拡張子から形式を決める。
    ///
    /// 拡張子が無い / 知らない場合は [`BookErrorCode::UnknownExtension`] にする。
    /// ShogiHome は既知の3拡張子以外を Apery と見なすが、それをすると別物の
    /// ファイルを固定長レコードとして読み進めてしまうため、ここでは拒否する。
    pub(crate) fn from_path(path: &Path) -> Result<Self, BookError> {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());

        match ext.as_deref() {
            Some("db") => Ok(BookFormat::YaneuraouDb),
            Some("bin") => Ok(BookFormat::AperyBin),
            Some("sbk") => Ok(BookFormat::ShogiGuiSbk),
            Some("ybb") => Ok(BookFormat::YaneuraouYbb),
            _ => Err(BookError::new(
                BookErrorCode::UnknownExtension,
                "拡張子から定跡の形式を判別できない（.db / .bin / .sbk / .ybb）",
            )
            .with_path(path.to_string_lossy())),
        }
    }
}

/// 定跡が持つ1手ぶんの情報。
///
/// `value` / `depth` / `count` は形式によっては存在せず、同じ形式でも行ごとに
/// 欠けることがあるので optional。出典: やねうら王 `source/book/book.h:51-68`。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookMove {
    /// USI 表記の指し手（`7g7f` / `P*5e` など）
    pub usi_move: String,
    /// 相手の応手。定跡に `none` と書かれていた場合は `None`
    pub ponder: Option<String>,
    /// 手番側から見た評価値
    pub value: Option<i32>,
    /// この手を決めたときの探索深さ
    pub depth: Option<i32>,
    /// この手が選ばれた回数
    pub count: Option<u64>,
}

/// 開いている定跡のメタ情報。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookInfo {
    pub handle: BookHandle,
    /// 開いた定跡の実体のパス（symlink を解決したもの）
    pub path: String,
    pub format: BookFormat,
    /// 収録局面の数。指し手の数ではない。
    ///
    /// 開いた時点で確定する。全件を数えずに開く on-the-fly の reader でも、
    /// ファイルに書かれた局面数（やねうら王の `# NOE:N` など）を使って埋めること。
    /// 数えられない形式は 0 を返してよい
    pub position_count: u64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenBookInput {
    /// 定跡ファイルの絶対パス。空・NUL 入り・相対パスは `InvalidPath` になる。
    /// symlink は実体に解決され、`BookInfo::path` には実体が入る。指定した綴りと
    /// 実体の形式が食い違う場合も `InvalidPath`
    pub path: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LookupBookMovesInput {
    pub handle: BookHandle,
    /// 局面の SFEN。手数は付いていてもよい（キーからは落とす）が、書式は検査する。
    /// 数値でない手数、`moves` 付き、余分なトークンは `InvalidSfen` になる
    pub sfen: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookHandleInput {
    pub handle: BookHandle,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn format_of(path: &str) -> Result<BookFormat, BookError> {
        BookFormat::from_path(&PathBuf::from(path))
    }

    #[test]
    fn detects_each_known_extension() {
        assert_eq!(
            format_of("/books/standard.db").unwrap(),
            BookFormat::YaneuraouDb
        );
        assert_eq!(format_of("/books/book.bin").unwrap(), BookFormat::AperyBin);
        assert_eq!(
            format_of("/books/book.sbk").unwrap(),
            BookFormat::ShogiGuiSbk
        );
        assert_eq!(
            format_of("/books/book.ybb").unwrap(),
            BookFormat::YaneuraouYbb
        );
    }

    #[test]
    fn extension_match_ignores_case() {
        assert_eq!(
            format_of("/books/STANDARD.DB").unwrap(),
            BookFormat::YaneuraouDb
        );
    }

    #[test]
    fn rejects_unknown_and_missing_extension() {
        for path in ["/books/book.txt", "/books/book", "/books/.db/x"] {
            let err = format_of(path).unwrap_err();
            assert_eq!(err.code, BookErrorCode::UnknownExtension, "path={path}");
            assert_eq!(err.path.as_deref(), Some(path));
        }
    }

    /// `standard_book.db.bak` のような多重拡張子は最後だけを見る。
    #[test]
    fn uses_only_the_last_extension() {
        assert!(format_of("/books/standard.db.bak").is_err());
        assert_eq!(
            format_of("/books/standard.bak.db").unwrap(),
            BookFormat::YaneuraouDb
        );
    }
}
