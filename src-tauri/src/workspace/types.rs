//! 画面のファイルツリーへ渡す形。欄の綴りは webview の `RustFileTreeNode` と結ばれている。

use serde::{Deserialize, Serialize};

/// ファイルツリーの1行。フォルダなら下の行を `children` に持つ
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileTreeNode {
    /// 走査のたびに振り直す識別子。同じファイルでも、読み直すと別の値になる
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    /// 下の行。ファイルと、出す行が1つも無いフォルダは `None`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
    /// 走査を途中で打ち切った。
    ///
    /// これを返さないと、上限に当たったフォルダが**空のフォルダと同じ形**で届く。
    /// 棋譜が入っているのに空に見え、何度読み直しても同じ表示になる。
    /// 受け取り側は `RustFileTreeNode` → `toFileTreeNode` →
    /// `TruncatedNotice`（`src/__tests__/fileTreeWire.test.ts` が写し忘れを止める）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    /// 更新時刻。Unix 時間の秒で、OS が返さなければ `None`
    #[serde(rename = "lastModified", skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<i64>,
    /// バイト数。フォルダは `None`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// 小文字にした拡張子。フォルダと、拡張子の無いファイルは `None`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
}
