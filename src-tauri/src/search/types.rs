use serde::{Deserialize, Serialize};

pub const EVT_INDEX_STATE: &str = "position-index-state";
pub const EVT_INDEX_PROGRESS: &str = "position-index-progress";
pub const EVT_INDEX_WARN: &str = "position-index-warn";
pub const EVT_SEARCH_BEGIN: &str = "position-search-begin";
pub const EVT_SEARCH_CHUNK: &str = "position-search-chunk";
pub const EVT_SEARCH_END: &str = "position-search-end";
pub const EVT_SEARCH_ERROR: &str = "position-search-error";

pub type RequestId = u64;
pub type FileId = u32;
pub type Gen = u32;
pub type NodeId = u32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub file_id: FileId,
    pub path: String,
    pub deleted: bool,
    pub gen: Gen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IndexState {
    Empty,
    Building,
    Ready,
    Updating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatePayload {
    pub state: IndexState,
    pub dirty_count: u32,
    pub indexed_files: u32,
    pub total_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Consistency {
    BestEffort,   // 今あるsnapshotで即検索（stale可）
    WaitForClean, // dirty反映を待つ（上限は内部で）
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPositionInput {
    pub sfen: String,
    pub consistency: Consistency,
    pub chunk_size: u32, // 例: 2000〜10000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPositionOutput {
    pub request_id: RequestId,
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize)]
pub struct ForkPointer {
    pub te: u32,
    pub fork_index: u32,
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Occurrence {
    pub file_id: FileId,
    pub gen: Gen,
    pub node_id: NodeId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorLite {
    pub tesuu: u32,
    pub fork_pointers: Vec<ForkPointer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionHit {
    pub occ: Occurrence,
    pub cursor: CursorLite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchBeginPayload {
    pub request_id: RequestId,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchChunkPayload {
    pub request_id: RequestId,
    pub chunk: Vec<PositionHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchEndPayload {
    pub request_id: RequestId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchErrorPayload {
    pub request_id: RequestId,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenProjectInput {
    pub root_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenProjectOutput {
    pub total_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexProgressPayload {
    pub current_path: String,
    pub done_files: u32,
    pub total_files: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexWarnPayload {
    pub path: String,
    pub message: String,
}
