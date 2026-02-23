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
