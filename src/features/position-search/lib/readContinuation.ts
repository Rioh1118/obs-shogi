import { advanceCurrentLine } from "@/entities/kifu/lib/advanceWithPlan";
import { buildPlayer } from "@/entities/kifu/lib/buildPlayer";
import type { CursorPath } from "@/entities/kifu/model/cursor";
import type { JKFData } from "@/entities/kifu/model/jkf";

/** ヒット局面から、その線の続きを `ply` 手ぶん読む */
export function readContinuation(jkf: JKFData, cursor: CursorPath, ply: number): string[] {
  const player = buildPlayer(jkf, cursor);
  const out: string[] = [];

  for (let i = 0; i < ply; i++) {
    // ヒット局面が乗っている線の続きを辿る（変化の中のヒットなら変化の続き）。
    // 索引のカーソルは「辿った経路」で `te > tesuu` を持たないので、
    // 渡せる計画がそもそも無い（`planByTe(cursor.forkPointers)` を渡しても
    // 引く te が `tesuu + 1` 以降なので1度も当たらない）。
    if (!advanceCurrentLine(player).moved) break;

    const s = player.getReadableKifu?.() ?? "";
    if (s) out.push(s);
  }

  return out;
}
