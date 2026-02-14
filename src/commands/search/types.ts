// Rust: pub enum Consistency { BestEffort, WaitForClean }
export type Consistency = "BestEffort" | "WaitForClean";

// Rust: pub struct OpenProjectInput { root_dir: String }
export interface OpenProjectInput {
  root_dir: string;
}

// Rust: pub struct OpenProjectOutput { total_files: u32 }
export interface OpenProjectOutput {
  total_files: number;
}

// Rust: pub struct SearchPositionInput { sfen: String, consistency: Consistency, chunk_size: u32 }
export interface SearchPositionInput {
  sfen: string;
  consistency: Consistency;
  chunk_size: number; // 例: 2000〜10000
}

// Rust: pub struct SearchPositionOutput { request_id: u64 }
export interface SearchPositionOutput {
  request_id: number;
}

// Rust: pub type FileId = u32; Gen=u32; NodeId=u32;
export type FileId = number;
export type Gen = number;
export type NodeId = number;
export type RequestId = number;

// Rust: pub struct ForkPointer { te: u32, fork_index: u32 }
export interface ForkPointer {
  te: number;
  fork_index: number;
}

// Rust: pub struct Occurrence { file_id, gen, node_id }
export interface Occurrence {
  file_id: FileId;
  gen: Gen;
  node_id: NodeId;
}

// Rust: pub struct FilePathEntry { file_id: u32, abs_path: String }
export interface FilePathEntry {
  file_id: FileId;
  abs_path: string;
}

// Rust: pub struct CursorLite { tesuu: u32, fork_pointers: Vec<ForkPointer> }
export interface CursorLite {
  tesuu: number;
  fork_pointers: ForkPointer[];
}

// Rust: pub struct PositionHit { occ: Occurrence, cursor: CursorLite }
export interface PositionHit {
  occ: Occurrence;
  cursor: CursorLite;
}

// Rust: pub enum IndexState { Empty, Building, Ready, Updating }
export type IndexState = "Empty" | "Building" | "Ready" | "Updating";

// Rust: pub struct IndexStatePayload { state, dirty_count, indexed_files, total_files }
export interface IndexStatePayload {
  state: IndexState;
  dirty_count: number;
  indexed_files: number;
  total_files: number;
}

// Rust: pub struct IndexProgressPayload { current_path, done_files, total_files }
export interface IndexProgressPayload {
  current_path: string;
  done_files: number;
  total_files: number;
}

// Rust: pub struct IndexWarnPayload { path, message }
export interface IndexWarnPayload {
  path: string;
  message: string;
}

// Rust: pub struct SearchBeginPayload { request_id, stale }
export interface SearchBeginPayload {
  request_id: RequestId;
  stale: boolean;
}

// Rust: pub struct SearchChunkPayload { request_id, chunk: Vec<PositionHit> }
export interface SearchChunkPayload {
  request_id: RequestId;
  chunk: PositionHit[];
  files: FilePathEntry[];
}

// Rust: pub struct SearchEndPayload { request_id }
export interface SearchEndPayload {
  request_id: RequestId;
}

// Rust: pub struct SearchErrorPayload { request_id, message }
export interface SearchErrorPayload {
  request_id: RequestId;
  message: string;
}

// ===== イベント名（Rust const と一致させる） =====
export const EVT_INDEX_STATE = "position-index-state" as const;
export const EVT_INDEX_PROGRESS = "position-index-progress" as const;
export const EVT_INDEX_WARN = "position-index-warn" as const;

export const EVT_SEARCH_BEGIN = "position-search-begin" as const;
export const EVT_SEARCH_CHUNK = "position-search-chunk" as const;
export const EVT_SEARCH_END = "position-search-end" as const;
export const EVT_SEARCH_ERROR = "position-search-error" as const;
