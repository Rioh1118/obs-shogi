import { ROOT_CURSOR, type ForkPointer, type KifuCursor } from "@/entities/kifu/model/cursor";
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
  const forkPointers: ForkPointer[] = forkIndex == null ? prefix : [...prefix, { te, forkIndex }];

  return { tesuu: te, forkPointers, tesuuPointer: buildTesuuPointer(te, forkPointers) };
}
