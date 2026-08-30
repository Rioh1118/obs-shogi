import type { JKFPlayer } from "json-kifu-format";
import type { ForkPointer } from "../model/cursor";

/**
 * 計画を手数で引ける形にしたもの
 *
 * 1手進めるたびに `ForkPointer[]` を線形に探すと、末尾まで歩く側が
 * 計画の長さぶん余計に走る。歩き始める前に1度だけ組む。
 */
export type PlanIndex = ReadonlyMap<number, number>;

/** `ForkPointer[]` を `PlanIndex` にする。同じ te が重なれば後勝ち。 */
export function indexPlan(forkPointers: readonly ForkPointer[] | undefined): PlanIndex {
  const index = new Map<number, number>();
  for (const p of forkPointers ?? []) index.set(p.te, p.forkIndex);
  return index;
}

/** `advanceWithPlan` が1手ぶん進めた結果 */
export type PlanStep = {
  /** 進んだか。`false` なら player は動いていない（葉に着いた） */
  moved: boolean;
  /**
   * 実際に降りた変化の `forkIndex`。本譜を進んだときと、計画が使えず本譜へ落ちたときは `null`。
   *
   * **計画の値ではなく、この1手が実際に選んだもの。** 計画をそのまま載せると、
   * 落ちたのに「変化1を選んだ」と言う値が出て、画面のバッジと ✓ が食い違う。
   */
  forkIndex: number | null;
};

const NOT_MOVED: PlanStep = { moved: false, forkIndex: null };

/**
 * 計画に沿って1手進める
 *
 * `ForkPointer` は「これから降りるつもり」の計画であって、実在する保証は無い。
 * 別の分岐で選んだ計画が `mergeBranchPlan` で持ち越されるので、いまの線には
 * 無い te や、範囲外・負・非整数の `forkIndex` が普通に混ざる。
 * **無効なら黙って本譜へ落とす**、というのがこの規則。
 *
 * 手が無いのに `forkAndForward` を呼ぶと「N手目に有効な棋譜がありません」を投げるので、
 * 呼ぶ前に線の続きがあるかを見る。`forkAndForward` は `forks.length` 以上なら
 * `false` を返すだけだが、負や非整数は `forks[-1]` を掴んで `JKFPlayer` の内部で
 * `TypeError` になるので、渡す前に捨てる。
 *
 * 例外を投げないので、レンダ中の走査（棋譜ストリームの行組み立て）からも呼べる。
 */
export function advanceWithPlan(player: JKFPlayer, plan: PlanIndex): PlanStep {
  const te = player.tesuu + 1;
  if (!player.currentStream[te]) return NOT_MOVED;

  const forkIndex = plan.get(te);
  if (forkIndex !== undefined && Number.isInteger(forkIndex) && forkIndex >= 0) {
    if (player.forkAndForward(forkIndex)) return { moved: true, forkIndex };
  }

  return player.forward() ? { moved: true, forkIndex: null } : NOT_MOVED;
}

/** `JKFPlayer.goto` が内部で使う上限と同じ。片方だけ先に打ち切ると値が食い違う。 */
export const PLAN_WALK_LIMIT = 10000;

/**
 * 計画に沿って葉まで進める
 *
 * @throws {Error} `PLAN_WALK_LIMIT` 手進んでも葉に着かないとき
 */
export function advanceToLeafWithPlan(player: JKFPlayer, plan: PlanIndex): void {
  for (let steps = 0; steps <= PLAN_WALK_LIMIT; steps += 1) {
    if (!advanceWithPlan(player, plan).moved) return;
  }
  throw new Error("plan walk overflows");
}
