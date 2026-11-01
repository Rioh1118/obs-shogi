// `src-tauri/src/search/types.rs` の写し。欄の一致は `src/__tests__/searchWire.test.ts` が見る。

export type Consistency = "BestEffort" | "WaitForClean";

export type OpenProjectInput = {
  rootDir: string;
};

export type OpenProjectOutput = {
  totalFiles: number;
};

export type SearchPositionInput = {
  sfen: string;
  consistency: Consistency;
  chunkSize: number;
};

export type SearchPositionOutput = {
  requestId: number;
};

export type CancelSearchInput = {
  requestId: number;
};
