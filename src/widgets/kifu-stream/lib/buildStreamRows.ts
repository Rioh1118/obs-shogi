import type { KifuCursor } from "@/entities/kifu/model/cursor";
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
  cursor: KifuCursor | null,
): RowModel[] {
  const planned = new Map<number, number>();
  for (const p of cursor?.forkPointers ?? []) planned.set(p.te, p.forkIndex);

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

    const plannedForkIndex = planned.get(te) ?? null;

    let ok = false;
    // forkAndForward は forks.length 以上なら false を返すが、負や非整数は
    // forks[-1] を掴んで JKFPlayer の内部で TypeError になる。ここはレンダ中なので、
    // 拾わないと棋譜ペインごと落ちる。計画は無検証で持ち越されるので自分で捨てる。
    if (plannedForkIndex != null && Number.isInteger(plannedForkIndex) && plannedForkIndex >= 0) {
      ok = player.forkAndForward(plannedForkIndex);
      if (!ok) ok = player.forward();
    } else {
      ok = player.forward();
    }
    if (!ok) break;

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
      selectedForkIndex: plannedForkIndex,
      isActive: te === currentTesuu,
      branchForkPointers,
    });
  }

  return rows;
}
