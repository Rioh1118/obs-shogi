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
