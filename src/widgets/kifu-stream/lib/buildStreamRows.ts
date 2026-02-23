import type { KifuCursor } from "@/entities/kifu/model/cursor";
import type { JKFPlayer } from "json-kifu-format";
import type { RowModel } from "../ui/KifuMoveCard";

export function buildStreamRowsFromCursor(
  jkf: JKFPlayer,
  cursor: KifuCursor | null,
): RowModel[] {
  const planned = new Map<number, number>();
  for (const p of cursor?.forkPointers ?? []) planned.set(p.te, p.forkIndex);

  const rows: RowModel[] = [];
  const currentTesuu = cursor?.tesuu ?? 0;

  const mf0 = jkf.currentStream[0];
  rows.push({
    te: 0,
    side: "none",
    text: "開始局面",
    commentCount: (mf0?.comments ?? []).length,
    mainText: "開始局面",
    forkTexts: [],
    forkCount: 0,
    selectedForkIndex: null,
    isActive: currentTesuu === 0,
    branchForkPointers: [],
  });

  let safety = 100000;
  while (safety-- > 0) {
    const te = jkf.tesuu + 1;
    if (!jkf.currentStream[te]) break;

    const forkTexts = jkf.getReadableForkKifu?.() ?? [];
    const mainText = (() => {
      const ok = jkf.forward();
      if (!ok) return "";
      const s = jkf.getReadableKifu?.() ?? "";
      jkf.backward();
      return s;
    })();

    const plannedForkIndex = planned.get(te) ?? null;

    let ok = false;
    if (plannedForkIndex != null) {
      ok = jkf.forkAndForward(plannedForkIndex);
      if (!ok) ok = jkf.forward();
    } else {
      ok = jkf.forward();
    }
    if (!ok) break;

    const mf = jkf.currentStream[te];
    const mv = mf?.move;

    const side =
      mv?.color === 0
        ? "sente"
        : mv?.color === 1
          ? "gote"
          : te % 2 === 1
            ? "sente"
            : "gote";

    const text = jkf.getReadableKifu?.() ?? "";

    const branchForkPointers = (cursor?.forkPointers ?? []).filter(
      (p) => p.te < te,
    );
    rows.push({
      te,
      side,
      text,
      commentCount: (mf?.comments ?? []).length,
      mainText,
      forkTexts,
      forkCount: forkTexts.length,
      selectedForkIndex: plannedForkIndex,
      isActive: te === currentTesuu,
      branchForkPointers,
    });
  }

  return rows;
}
