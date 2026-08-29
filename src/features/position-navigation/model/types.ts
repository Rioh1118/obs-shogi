import type { ForkPointer } from "@/entities/kifu/model/cursor";

export type PreviewCursorDraft = {
  tesuu: number;
  forkPointers: ForkPointer[];
};

export interface NavigationState {
  PreviewCursor: PreviewCursorDraft;
  selectedBranchIndex: number;
}
