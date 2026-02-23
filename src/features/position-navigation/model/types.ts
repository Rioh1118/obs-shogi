import type { ForkPointer } from "@/entities/kifu/model/cursor";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

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

export interface NavigationState {
  PreviewCursor: PreviewCursorDraft;
  selectedBranchIndex: number;
}
