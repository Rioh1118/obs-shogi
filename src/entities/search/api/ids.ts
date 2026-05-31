// Rust: pub type FileId = u32; Gen=u32; NodeId=u32;
export type FileId = number;
export type Gen = number;
export type NodeId = number;
export type RequestId = number;

// Rust: pub struct ForkPointer { te: u32, fork_index: u32 } -> camelCase
export interface ForkPointer {
  te: number;
  forkIndex: number;
}

// Rust: pub struct Occurrence { file_id, gen, node_id } -> camelCase + gen field renamed via #[serde(rename = "gen")]
export interface Occurrence {
  fileId: FileId;
  gen: Gen;
  nodeId: NodeId;
}

// Rust: pub struct FilePathEntry { file_id: u32, abs_path: String } -> camelCase
export interface FilePathEntry {
  fileId: FileId;
  absPath: string;
}

// Rust: pub struct CursorLite { tesuu: u32, fork_pointers: Vec<ForkPointer> } -> camelCase
export interface CursorLite {
  tesuu: number;
  forkPointers: ForkPointer[];
}

// Rust: pub struct PositionHit { occ: Occurrence, cursor: CursorLite }
export interface PositionHit {
  occ: Occurrence;
  cursor: CursorLite;
}
