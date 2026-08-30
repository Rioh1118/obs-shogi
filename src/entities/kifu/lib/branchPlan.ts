import {
  asBranchPlan,
  normalizeForkPointers,
  type BranchPlan,
  type ForkPointer,
  type KifuCursor,
} from "../model/cursor";

/**
 * 辿ったカーソルと、カーソルより先の計画を合成する。
 *
 * `prevPlan` / `overridePlan` を `fp.te > cursor.tesuu` で絞るのは、
 * 「`branchPlan` の `te <= cursor.tesuu` の部分は `cursor.forkPointers` と一致する」
 * （`docs/state-transitions/game.md` の不変条件1）を、この関数を通る書き込み経路が
 * 守るため。他の経路は空にするか `cursor.forkPointers` をそのまま写して守っている。
 */
export function mergeBranchPlan(
  cursor: KifuCursor,
  prevPlan: ForkPointer[],
  overridePlan?: ForkPointer[],
): BranchPlan {
  return asBranchPlan(
    normalizeForkPointers([
      ...cursor.forkPointers,
      ...prevPlan.filter((fp) => fp.te > cursor.tesuu),
      ...(overridePlan ?? []).filter((fp) => fp.te > cursor.tesuu),
    ]),
  );
}

/**
 * te の選択を計画に書き込む（同じ te があれば上書き）
 *
 * 返りは te 昇順。並びが崩れると `buildTesuuPointer` が同じ計画を別のキーにする。
 */
export function upsertForkPointer(
  fps: ForkPointer[],
  te: number,
  forkIndex: number,
): ForkPointer[] {
  const map = new Map<number, ForkPointer>();
  for (const p of fps) map.set(p.te, p);
  map.set(te, { te, forkIndex });
  return [...map.values()].sort((a, b) => a.te - b.te);
}

/**
 * te 以降の計画を捨てる
 *
 * te の選択を変えたら、その先の計画は別の枝に対して作られた値なので意味を失う。
 * 残すと、利用者が一度も見ていない変化に盤が入る。
 */
export function truncatePlanFrom(fps: ForkPointer[], te: number): ForkPointer[] {
  return fps.filter((p) => p.te < te);
}
