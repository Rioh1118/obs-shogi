import type { ForkPointer } from "@/entities/kifu/model/cursor";

export type PreviewCursorDraft = {
  tesuu: number;
  forkPointers: ForkPointer[];
};

export interface NavigationState {
  PreviewCursor: PreviewCursorDraft;
  /**
   * `buildNextOptions` が返した候補配列の添字。
   *
   * `BranchIndex` ではない。`buildNextOptions` は空の変化を読み飛ばすので、
   * 表示順の添字と分岐一覧の位置は一致しない。削除・入れ替えに渡す値ではない。
   */
  selectedOptionIndex: number;
}
