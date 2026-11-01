import type { Color, Kind, Piece } from "shogi.js";

export interface PreviewData {
  /** 空の升は `null`。`shogi.js` の型は `Piece[][]` だが実物は空升を含む */
  board: (Piece | null)[][];
  hands: Record<Color, Kind[]>;
  tesuu: number;
  turn: Color;
  nodeId: string;
}
