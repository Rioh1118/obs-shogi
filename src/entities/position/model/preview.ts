import type { Piece } from "shogi.js";

export interface PreviewData {
  /** 空の升は `null`。`shogi.js` の型は `Piece[][]` だが実物は空升を含む */
  board: (Piece | null)[][];
  hands: {
    0: string[];
    1: string[];
  };
  tesuu: number;
  turn: 0 | 1;
  nodeId: string;
}
