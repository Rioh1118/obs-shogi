import type { FilePathEntry, PositionHit, RequestId } from "./ids";

// Rust: pub enum IndexState
export type IndexState = "Empty" | "Restoring" | "Building" | "Ready" | "Updating";

// camelCase via serde(rename_all = "camelCase")
export interface IndexStatePayload {
  state: IndexState;
  dirtyCount: number;
  indexedFiles: number;
  totalFiles: number;
}

export interface IndexProgressPayload {
  currentPath: string;
  doneFiles: number;
  totalFiles: number;
}

export interface IndexWarnPayload {
  path: string;
  message: string;
}

export interface SearchBeginPayload {
  requestId: RequestId;
  stale: boolean;
}

export interface SearchChunkPayload {
  requestId: RequestId;
  chunk: PositionHit[];
  files: FilePathEntry[];
}

export interface SearchEndPayload {
  requestId: RequestId;
}

export interface SearchErrorPayload {
  requestId: RequestId;
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
