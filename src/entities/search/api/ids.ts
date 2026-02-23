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
