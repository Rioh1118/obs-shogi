import type { JKFPlayer } from "json-kifu-format";
import type { ForkPointer } from "../model/cursor";

/**
 * 計画を手数で引ける形にしたもの（`te` → `forkIndex`）
 *
 * 1手進めるたびに `ForkPointer[]` を線形に探すと、末尾まで歩く側が
 * 計画の長さぶん余計に走る。歩き始める前に1度だけ組む。
 *
 * `Index` を名前に使わないのは、このリポジトリで `BranchIndex` / `forkIndex` が
 * 「配列の添字」を指すため。こちらは添字ではなく引き当ての表。
 */
export type PlanByTe = ReadonlyMap<number, number>;

/** `ForkPointer[]` を `PlanByTe` にする。同じ te が重なれば後勝ち。 */
export function planByTe(forkPointers: readonly ForkPointer[] | undefined): PlanByTe {
  const byTe = new Map<number, number>();
  for (const p of forkPointers ?? []) byTe.set(p.te, p.forkIndex);
  return byTe;
}

/** `advanceWithPlan` が1手ぶん進めた結果 */
export type AdvanceResult = {
  /** 進んだか。`false` なら player は動いていない（葉に着いた） */
  moved: boolean;
  /**
   * この1手で新しく降りた変化の `forkIndex`。変化に降りずに線をそのまま進んだときは `null`
   * （計画が無かったときと、計画が使えず捨てたときの両方）。
   *
   * **計画の値ではなく、この1手が実際に選んだもの。** 計画をそのまま載せると、
   * 落ちたのに「変化1を選んだ」と言う値が出て、画面のバッジと ✓ が食い違う。
   */
  forkIndex: number | null;
};

const NOT_MOVED: AdvanceResult = { moved: false, forkIndex: null };

/**
 * 計画に沿って1手進める
 *
 * `ForkPointer` は「これから降りるつもり」の計画であって、実在する保証は無い。
 * 別の分岐で選んだ計画が `mergeBranchPlan` で持ち越されるので、いまの線には
 * 無い te や、範囲外・負・非整数の `forkIndex` が普通に混ざる。
 * **無効なら黙って捨て、いま辿っている線をそのまま1手進む**、というのがこの規則。
 * 落ちる先は本譜とは限らない。変化の中にいれば変化の続きへ進む
 * （`forward` が読む `currentStream` は `player.forkPointers` を降りた先の線）。
 *
 * 手が無いのに `forkAndForward` を呼ぶと「N手目に有効な棋譜がありません」を投げるので、
 * 呼ぶ前に線の続きがあるかを見る。`forkAndForward` は `forks.length` 以上なら
 * `false` を返すだけだが、負や非整数は `forks[-1]` を掴んで `JKFPlayer` の内部で
 * `TypeError` になるので、渡す前に捨てる。
 *
 * **計画が壊れていても投げない**のはここまで。盤の再生そのものは別で、
 * 再生できない手に当たれば `forward` が投げる。
 *
 * @throws {Error} 盤上で再生できない手に当たったとき（`JKFPlayer.forward` が投げる）。
 *   レンダ中に呼ぶなら呼び出し側で捕まえること（捕まえないと画面が落ちる）
 */
export function advanceWithPlan(player: JKFPlayer, plan: PlanByTe): AdvanceResult {
  const te = player.tesuu + 1;
  if (!player.currentStream[te]) return NOT_MOVED;

  const forkIndex = plan.get(te);
  if (forkIndex !== undefined && Number.isInteger(forkIndex) && forkIndex >= 0) {
    if (player.forkAndForward(forkIndex)) return { moved: true, forkIndex };
  }

  return player.forward() ? { moved: true, forkIndex: null } : NOT_MOVED;
}

const NO_PLAN: PlanByTe = new Map();

/**
 * 計画を使わず、**いま辿っている線**を1手進める
 *
 * 本譜とは限らない。変化の中にいれば変化の続きを進む（`currentStream` は
 * `player.forkPointers` を降りた先の線）。「本譜」はこのリポジトリでは
 * `MAIN_LINE` / `isMainLine` が指す別の概念なので、この関数名に含めない。
 *
 * 「計画が無い」ことを呼び出し側で言うためのもの。空の `PlanByTe` を渡すのと
 * 同じだが、`advanceWithPlan(player, planByTe(x))` と書いてある箇所は
 * 「x に沿って降りる」と読めてしまう。
 */
export function advanceCurrentLine(player: JKFPlayer): AdvanceResult {
  return advanceWithPlan(player, NO_PLAN);
}

/**
 * 際限なく歩き続けないための上限。`JKFPlayer.goto` が内部で使う数と同じ値。
 *
 * **`goto` と足並みが揃うとは考えないこと。** `goto` の番人は
 * `var c = 1e4; for (; tesuu !== e && forward() && c-- > 0;); if (0 === c) throw`
 * で、`c` がちょうど0で終わったときだけ投げる。つまり**ぴったり 10000 手動かす
 * `goto` だけが投げ、10001 手の `goto` は素通りする**（実測。
 * `__tests__/advanceWithPlan.test.ts` が固定している）。上限ではなく等値判定なので、
 * 「どちらが先に打ち切るか」を揃えようとしても揃わない。
 *
 * どちらが先に効くかは呼び出し側による。`navigate` を通る経路（`nextMove` / `goToEnd`）は
 * 毎回 `buildPlayer(state.jkf, state.cursor)` で player を作り直すので `goto` を先に通り、
 * `cursor.tesuu` がちょうど `PLAN_WALK_LIMIT` のときは `goto` の等値判定が先に投げる。
 * この上限だけが効くのは `cursor` が `null` の `computeLeafTesuu`
 * （`buildPlayer` の `applyCursorToPlayer` が `goto` を呼ばない）だけ。
 */
export const PLAN_WALK_LIMIT = 10000;

/**
 * 計画に沿って葉まで進める
 *
 * 葉に着いたことを確かめるには「`PLAN_WALK_LIMIT` 手進む」ぶんに加えて
 * 「もう進めない」を1回見る必要があるので、反復は `PLAN_WALK_LIMIT + 1` 回まで許す。
 * `< PLAN_WALK_LIMIT` にすると、確かめられる最長が 9999 手に落ちる。
 *
 * @throws {Error} `PLAN_WALK_LIMIT` 手進んでも葉に着かないとき
 * @throws {Error} 盤上で再生できない手に当たったとき（`advanceWithPlan` が投げる）
 */
export function advanceToLeafWithPlan(player: JKFPlayer, plan: PlanByTe): void {
  for (let steps = 0; steps <= PLAN_WALK_LIMIT; steps += 1) {
    if (!advanceWithPlan(player, plan).moved) return;
  }
  throw new Error("plan walk overflows");
}
