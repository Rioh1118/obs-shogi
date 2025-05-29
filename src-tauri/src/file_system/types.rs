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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<FileMeta>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileMeta {
    #[serde(rename = "fileType", skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(rename = "iconType", skip_serializing_if = "Option::is_none")]
    pub icon_type: Option<String>,
}
