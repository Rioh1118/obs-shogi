import type { Piece } from "shogi.js";

export interface PreviewData {
  board: Piece[][];
  hands: {
    0: string[];
    1: string[];
  };
  tesuu: number;
  turn: 0 | 1;
  nodeId: string;
}
