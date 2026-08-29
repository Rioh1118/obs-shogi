import type { JKFPlayer } from "json-kifu-format";
import type { KifuCursor } from "../model/cursor";
import { buildPlayer } from "./buildPlayer";

/**
 * 計画に沿って辿り着ける末端の手数を返す
 *
 * `cursor.forkPointers` は「これから選ぶ計画」も含むので、その通りに降りたときの葉を数える。
 * 計画が指す変化が実在しなければ本譜へ落ちる。
 *
 * @throws {Error} 盤上で再生できない手に当たったとき（`buildPlayer` が投げる）
 * @throws {Error} 上限まで進んでも葉に着かないとき
 */
export function computeLeafTesuu(player: JKFPlayer, cursor: KifuCursor | null): number {
  const sim = buildPlayer(player.kifu, cursor);
  // cursor が無いときは、渡された player の現在地から数える。
  if (!cursor) sim.goto(player.tesuu);

  const plannedMap = new Map<number, number>();
  for (const p of cursor?.forkPointers ?? []) {
    plannedMap.set(p.te, p.forkIndex);
  }

  // JKFPlayer.goto 自身が内部で使う上限に揃える。
  let limit = 10000;
  while (limit-- > 0) {
    const nextTe = sim.tesuu + 1;
    // 手が無いのに forkAndForward を呼ぶと「N手目に有効な棋譜がありません」を投げる。
    // 計画が線の末尾+1に残っているとここに来る。
    if (!sim.currentStream[nextTe]) break;

    const forkIndex = plannedMap.get(nextTe);
    if (forkIndex !== undefined) {
      const ok = sim.forkAndForward(forkIndex);
      if (ok) continue; // planned どおり分岐に入れた
      // planned が無効なら本線へフォールバック
    }

    const ok = sim.forward();
    if (!ok) break; // これ以上進めない = 葉
  }

  if (limit <= 0) throw new Error("leaf tesuu overflows");
  return sim.tesuu;
}
