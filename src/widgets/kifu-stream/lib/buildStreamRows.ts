import { advanceWithPlan, indexPlan } from "@/entities/kifu/lib/advanceWithPlan";
import type { PlannedCursor } from "@/entities/kifu/model/cursor";
import type { JKFPlayer } from "json-kifu-format";
import type { RowModel } from "../ui/KifuMoveCard";

/**
 * 棋譜ストリームの行を組む
 *
 * `player` を末尾まで進めるが、棋譜自体は書き換えない（`inputMove` を呼ばない）。
 * 呼び出し側はこの前提で棋譜を複製せずに渡している。ここで棋譜を編集しないこと。
 */
export function buildStreamRowsFromCursor(
  player: JKFPlayer,
  cursor: PlannedCursor | null,
): RowModel[] {
  const plan = indexPlan(cursor?.forkPointers);

  const rows: RowModel[] = [];
  const currentTesuu = cursor?.tesuu ?? 0;

  const mf0 = player.currentStream[0];
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
    const te = player.tesuu + 1;
    if (!player.currentStream[te]) break;

    const forkTexts = player.getReadableForkKifu?.() ?? [];
    const mainText = (() => {
      const ok = player.forward();
      if (!ok) return "";
      const s = player.getReadableKifu?.() ?? "";
      player.backward();
      return s;
    })();

    // 行が「選ばれている」と言う値は、この走査が実際に降りたものでなければならない。
    // 計画をそのまま載せると、本譜へ落ちたのにバッジは「変化1」でメニューの ✓ は本譜、
    // という食い違った画面になり、`branchIndexFromRow` が使えない値を投げる。
    const { moved, forkIndex: selectedForkIndex } = advanceWithPlan(player, plan);
    if (!moved) break;

    const mf = player.currentStream[te];
    const mv = mf?.move;

    const side =
      mv?.color === 0 ? "sente" : mv?.color === 1 ? "gote" : te % 2 === 1 ? "sente" : "gote";

    const text = player.getReadableKifu?.() ?? "";

    const branchForkPointers = (cursor?.forkPointers ?? []).filter((p) => p.te < te);
    rows.push({
      te,
      side,
      text,
      commentCount: (mf?.comments ?? []).length,
      mainText,
      forkTexts,
      forkCount: forkTexts.length,
      selectedForkIndex,
      isActive: te === currentTesuu,
      branchForkPointers,
    });
  }

  return rows;
}
