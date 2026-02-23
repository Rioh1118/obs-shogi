import type { ForkPointer } from "@/entities/kifu/model/cursor";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { Piece } from "shogi.js";

export type PreviewCursorDraft = {
  tesuu: number;
  forkPointers: ForkPointer[];
};

export type BranchOption = {
  id: string;
  isMainLine: boolean;
  tesuu: number;
  move?: IMoveMoveFormat;
  forkIndex?: number;
};

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

export interface NavigationState {
  PreviewCursor: PreviewCursorDraft;
  selectedBranchIndex: number;
}
