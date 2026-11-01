// Rust: pub enum Consistency { BestEffort, WaitForClean }
export type Consistency = "BestEffort" | "WaitForClean";

// Rust: pub struct OpenProjectInput { root_dir: String } -> camelCase
export type OpenProjectInput = {
  rootDir: string;
};

// Rust: pub struct OpenProjectOutput { total_files: u32 } -> camelCase
export type OpenProjectOutput = {
  totalFiles: number;
};

// Rust: pub struct SearchPositionInput { sfen, consistency, chunk_size } -> camelCase
export type SearchPositionInput = {
  sfen: string;
  consistency: Consistency;
  chunkSize: number;
};

// Rust: pub struct SearchPositionOutput { request_id: u64 } -> camelCase
export type SearchPositionOutput = {
  requestId: number;
};

// Rust: pub struct CancelSearchInput { request_id: u64 } -> camelCase
export type CancelSearchInput = {
  requestId: number;
};
