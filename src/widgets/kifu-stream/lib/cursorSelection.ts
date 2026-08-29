import {
  ROOT_CURSOR,
  normalizeForkPointers,
  type ForkPointer,
  type KifuCursor,
} from "@/entities/kifu/model/cursor";
import {
  branchIndexFromSelection,
  buildTesuuPointer,
  type BranchIndex,
} from "@/entities/kifu/model/branch";
import type { RowModel } from "../ui/KifuMoveCard";

export const branchIndexFromRow = (r: RowModel): BranchIndex => {
  return branchIndexFromSelection(r.selectedForkIndex);
};

export function buildCursorWithForkSelection(
  base: KifuCursor | null,
  te: number,
  forkIndex: number | null,
): KifuCursor {
  const prev = base ?? ROOT_CURSOR;

  const prefix = (prev.forkPointers ?? []).filter((p) => p.te < te);
  const picked: ForkPointer[] = forkIndex == null ? prefix : [...prefix, { te, forkIndex }];
  // buildTesuuPointer は並びをそのまま文字列にする。正規化を通さないと、
  // 同じ局面が並び順の違いで別のキーになり、コメント欄の開閉判定が外れる。
  const forkPointers = normalizeForkPointers(picked, te);

  return { tesuu: te, forkPointers, tesuuPointer: buildTesuuPointer(te, forkPointers) };
}

/** 分岐メニューの選択が、局面の指定になるのか、その手数への移動で足りるのか */
export type ForkSelection = { kind: "goto"; te: number } | { kind: "apply"; cursor: KifuCursor };

/**
 * 分岐メニューで選ばれた項目を、次に呼ぶ操作へ振り分ける
 *
 * `planned` は**行のチェックを描いたのと同じカーソル**（`state.branchPlan` から組む）を渡す。
 * `state.cursor` を渡してはならない。`cursor.forkPointers` は `te <= cursor.tesuu` に
 * 正規化されていてカーソルより先の選択を持たないので、先の行はどの項目も
 * 「選ばれていない」と読める。すると「本譜」を押したときだけ一致してしまい、
 * 計画を積んだままの `goToIndex` に落ちて、本譜どころか変化が確定する。
 */
export function resolveForkSelection(
  planned: KifuCursor,
  te: number,
  forkIndex: number | null,
): ForkSelection {
  const selected = planned.forkPointers.find((p) => p.te === te)?.forkIndex ?? null;
  if (selected === forkIndex) return { kind: "goto", te };

  return { kind: "apply", cursor: buildCursorWithForkSelection(planned, te, forkIndex) };
}
