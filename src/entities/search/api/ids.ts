// Rust: pub type FileId = u32; Gen=u32; NodeId=u32;
export type FileId = number;
type Gen = number;
type NodeId = number;
export type RequestId = number;

// Rust: pub struct ForkPointer { te: u32, fork_index: u32 } -> camelCase
export type ForkPointer = {
  te: number;
  forkIndex: number;
};

// Rust: pub struct Occurrence { file_id, gen, node_id } -> camelCase + gen field renamed via #[serde(rename = "gen")]
export type Occurrence = {
  fileId: FileId;
  gen: Gen;
  nodeId: NodeId;
};

// Rust: pub struct FilePathEntry { file_id: u32, abs_path: String } -> camelCase
export type FilePathEntry = {
  fileId: FileId;
  absPath: string;
};

// Rust: pub struct CursorLite { tesuu: u32, fork_pointers: Vec<ForkPointer> } -> camelCase
export type CursorLite = {
  tesuu: number;
  forkPointers: ForkPointer[];
};

// Rust: pub struct PositionHit { occ: Occurrence, cursor: CursorLite }
export type PositionHit = {
  occ: Occurrence;
  cursor: CursorLite;
};
