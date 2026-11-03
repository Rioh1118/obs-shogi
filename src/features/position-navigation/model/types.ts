import type { CursorPath } from "@/entities/kifu/model/cursor";

export type NavigationState = {
  /**
   * プレビューが見ている位置と、そこへ降りるための選択。
   *
   * `tesuu` より先の `ForkPointer` を持ちうる。`handlePrevious` は `tesuu` だけ戻して
   * 計画を残すので、戻ってから確定すると先の選択が `branchPlan` に引き継がれる。
   *
   * ただし開いたときの初期値は計画を持たない。初期値は `state.cursor`
   * （`te <= tesuu` に正規化済み）からだけ作り、`state.branchPlan` が持つ
   * カーソルより先の選択は載らない。盤が変化へ進むつもりでいても、ナビは本譜を選んで開く。
   * 他の読み手は `plannedCursorFrom` で計画を重ねている
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
};
