use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileTreeNode {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
    /// 走査を途中で打ち切った。
    ///
    /// これを返さないと、上限に当たったフォルダが**空のフォルダと同じ形**で届く。
    /// 棋譜が入っているのに空に見え、何度読み直しても同じ表示になる。
    /// 受け取り側は `RustFileTreeNode` → `RustFileTreeAdapter` →
    /// `TruncatedNotice`（`src/__tests__/fileTreeWire.test.ts` が写し忘れを止める）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    #[serde(rename = "lastModified", skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<i64>, // Unix timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
}
