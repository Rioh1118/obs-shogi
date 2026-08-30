/**
 * 分岐の番号が振り直された回数。棋譜（絶対パス）ごとに数える。
 *
 * `forkIndex` は `forks` 配列の**位置**で、分岐の削除・入れ替えがその配列を詰めたり
 * 入れ替えたりする。番号を含む値（`KifuCursor`）を非同期の境界を跨いで持ち回ると、
 * 走る時点では**別の変化**を指す。そのまま書くと、打っていない変化に本文が入り、
 * **その変化に元からあったコメントが消える**。書き込みは成功するので画面には何も出ない。
 *
 * **進めるのは「番号が実際に動いた瞬間」。** 書き込みの成否を待たない。
 * メモリ上の `forks` は `jkf_replaced` の時点でもう詰まっており、
 * 待っている間に走る書き込みはその詰まった配列に古い番号を当てる。
 * 巻き戻したときも「もう一度動いた」ので、そこでも進める。
 *
 * 番号を跨いで持ち回る側は、撃った時点の値を掴んでおき、使う前に突き合わせる。
 */
const generations = new Map<string, number>();

function keyOf(absPath: string | null): string {
  return absPath ?? "";
}

export function branchGenerationOf(absPath: string | null): number {
  return generations.get(keyOf(absPath)) ?? 0;
}

export function bumpBranchGeneration(absPath: string | null): void {
  const key = keyOf(absPath);
  generations.set(key, (generations.get(key) ?? 0) + 1);
}

/** テスト用。実行時に呼ぶ場所は無い */
export function resetBranchGenerations(): void {
  generations.clear();
}
