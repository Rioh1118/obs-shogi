// `src-tauri/src/search/types.rs` の写し。欄の一致は `src/__tests__/searchWire.test.ts` が見る。

export type FileId = number;
type Gen = number;
type NodeId = number;
export type RequestId = number;

export type ForkPointer = {
  te: number;
  forkIndex: number;
};

export type Occurrence = {
  fileId: FileId;
  gen: Gen;
  nodeId: NodeId;
};

export type FilePathEntry = {
  fileId: FileId;
  absPath: string;
};

export type CursorLite = {
  tesuu: number;
  forkPointers: ForkPointer[];
};

export type PositionHit = {
  occ: Occurrence;
  cursor: CursorLite;
};
