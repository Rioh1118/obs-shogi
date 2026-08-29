import type { ForkPointer } from "@/entities/kifu/model/cursor";

export type previewCursorDraft = {
  tesuu: number;
  forkPointers: ForkPointer[];
};

export interface NavigationState {
  previewCursor: previewCursorDraft;
  /**
   * `buildNextOptions` が返した候補配列の添字。
   *
   * `BranchIndex` ではない。`buildNextOptions` は先頭が空の変化を読み飛ばすので、
   * 一致する保証が無い。削除・入れ替えに渡すなら `BranchOption.forkIndex` から
   * `branchIndexFromSelection` で作り直すこと。
   */
  selectedOptionIndex: number;
}
