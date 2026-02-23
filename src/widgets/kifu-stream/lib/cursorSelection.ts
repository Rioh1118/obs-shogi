import type {
  ForkPointer,
  KifuCursor,
  TesuuPointer,
} from "@/entities/kifu/model/cursor";
import type { RowModel } from "../ui/KifuMoveCard";

export const branchIndexFromRow = (r: RowModel): number => {
  return r.selectedForkIndex == null ? 0 : r.selectedForkIndex + 1;
};

export function buildCursorWithForkSelection(
  base: KifuCursor | null,
  te: number,
  forkIndex: number | null,
): KifuCursor {
  const prev: KifuCursor = base ?? {
    tesuu: 0,
    forkPointers: [],
    tesuuPointer: "0,[]" as TesuuPointer,
  };

  const prefix = (prev.forkPointers ?? []).filter((p) => p.te < te);
  const forkPointers: ForkPointer[] =
    forkIndex == null ? prefix : [...prefix, { te, forkIndex }];

  const tesuu = te;
  const tesuuPointer =
    `${tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;

  return { tesuu, forkPointers, tesuuPointer };
}
