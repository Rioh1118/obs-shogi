import type { JKFData } from "../model/jkf";
import type { KifuCursor } from "../model/cursor";
import { buildPlayer } from "./buildPlayer";

/** `JKFPlayer.goto` が内部で使う上限と同じ。片方だけ先に打ち切ると値が食い違う。 */
const LEAF_TESUU_LIMIT = 10000;

/**
 * 計画に沿って辿り着ける末端の手数を返す
 *
 * `cursor.forkPointers` は「これから選ぶ計画」も含むので、その通りに降りたときの葉を数える。
 * 計画が指す変化が実在しなければ（範囲外・負・非整数のいずれでも）本譜へ落ちる。
 * `cursor` が無ければ本譜の末尾。
 *
 * @throws {Error} 盤上で再生できない手に当たったとき（`buildPlayer` が投げる）
 * @throws {Error} `LEAF_TESUU_LIMIT` 手進んでも葉に着かないとき
 */
export function computeLeafTesuu(jkf: JKFData, cursor: KifuCursor | null): number {
  const sim = buildPlayer(jkf, cursor);

  const plannedMap = new Map<number, number>();
  for (const p of cursor?.forkPointers ?? []) {
    plannedMap.set(p.te, p.forkIndex);
  }

  // JKFPlayer.goto 自身が内部で使う上限に揃える。片方だけ先に打ち切ると値が食い違う。
  // for にしているのは、下の continue でも増分を通すため。
  let steps = 0;
  for (; steps <= LEAF_TESUU_LIMIT; steps++) {
    const nextTe = sim.tesuu + 1;
    // 手が無いのに forkAndForward を呼ぶと「N手目に有効な棋譜がありません」を投げる。
    // 計画が線の末尾+1に残っているとここに来る。
    if (!sim.currentStream[nextTe]) break;

    const forkIndex = plannedMap.get(nextTe);
    // forkAndForward は forks.length 以上なら false を返すが、負や非整数は
    // forks[-1] を掴んで JKFPlayer の内部で TypeError になる。
    // 計画は無検証で持ち越されるので、ここで捨てて本譜へ落とす。
    if (forkIndex !== undefined && Number.isInteger(forkIndex) && forkIndex >= 0) {
      const ok = sim.forkAndForward(forkIndex);
      if (ok) continue; // planned どおり分岐に入れた
      // planned が無効なら本線へフォールバック
    }

    if (!sim.forward()) break; // これ以上進めない = 葉
  }

  if (steps > LEAF_TESUU_LIMIT) throw new Error("leaf tesuu overflows");
  return sim.tesuu;
}
