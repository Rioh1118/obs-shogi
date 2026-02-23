import type { FilePathEntry, PositionHit, RequestId } from "./ids";

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
