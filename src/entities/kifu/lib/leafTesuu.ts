import type { JKFData } from "../model/jkf";
import type { PlannedCursor } from "../model/cursor";
import { advanceToLeafWithPlan, planByTe } from "./advanceWithPlan";
import { buildPlayer } from "./buildPlayer";

/**
 * 計画に沿って辿り着ける末端の手数を返す
 *
 * `cursor.forkPointers` は「これから選ぶ計画」も含むので、その通りに降りたときの葉を数える。
 * `cursor.tesuu` より先の計画は、指す変化が実在しなければ（範囲外・負・非整数のいずれでも）
 * 本譜へ落ちる（`advanceWithPlan`）。`cursor.tesuu` までのぶんは `buildPlayer` の `goto` が
 * 扱うので、**そちらは負・非整数で `TypeError` になる**。`cursor` が無ければ本譜の末尾。
 *
 * @throws {Error} 盤上で再生できない手に当たったとき（`buildPlayer` と、葉まで歩く
 *   `advanceToLeafWithPlan` の両方が投げうる）
 * @throws {TypeError} `cursor.tesuu` までの `forkIndex` が負・非整数のとき（`buildPlayer`）
 * @throws {Error} `PLAN_WALK_LIMIT` 手進んでも葉に着かないとき
 */
export function computeLeafTesuu(jkf: JKFData, cursor: PlannedCursor | null): number {
  const sim = buildPlayer(jkf, cursor);
  advanceToLeafWithPlan(sim, planByTe(cursor?.forkPointers));
  return sim.tesuu;
}
