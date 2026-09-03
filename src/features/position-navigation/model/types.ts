import type { CursorPath } from "@/entities/kifu/model/cursor";

export interface NavigationState {
  /**
   * プレビューが見ている位置と、そこへ降りるための選択。
   *
   * `tesuu` より先の `ForkPointer` を持ちうる。`handlePrevious` は `tesuu` だけ戻して
   * 計画を残すので、戻ってから確定すると先の選択が `branchPlan` に引き継がれる。
   *
   * ただし**種は計画を持たない**。モーダルを開くときの初期値は `state.cursor`
   * （`te <= tesuu` に正規化済み）からだけ作られ、`state.branchPlan` が持つ
   * カーソルより先の選択は載らない → #297
   */
  previewCursor: CursorPath;
  /**
   * `buildNextOptions` が返した候補配列の添字。
   *
   * `BranchIndex` ではない。`buildNextOptions` は先頭が空の変化を読み飛ばすので、
   * 一致する保証が無い。削除・入れ替えに渡すなら `BranchOption.forkIndex` から
   * `branchIndexFromSelection` で作り直すこと。
   */
  selectedOptionIndex: number;
}
