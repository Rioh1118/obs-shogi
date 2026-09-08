/**
 * 前に見たところまでが、いまの並びの先頭とそのまま一致しているか。
 *
 * 末尾へ追記されるだけの列に対して、**前回の続きから足せばよいか**を答える。
 * 真なら `consumed` 番目から末尾までが新着ぶん。偽なら先頭から作り直す。
 *
 * **末尾の1つしか見ない。** 中間の要素が差し替わる並び（並べ直し・重複除去が
 * 入りうるもの）には使えない——長さと `consumed - 1` 番目さえ合っていれば真を
 * 返すので、**古い並びを黙って返し続ける**ことになる。追記しかしないと言い切れる
 * 列にだけ使うこと。
 *
 * 要素の一致は参照で見る。局面検索のヒットのように、届いた実体をそのまま保つ
 * 列を想定している。
 */
export function isAppendOnlyContinuation<T>(
  list: readonly T[],
  consumed: number,
  lastConsumed: T | null,
): boolean {
  if (consumed > list.length) return false;
  if (consumed === 0) return true;
  return list[consumed - 1] === lastConsumed;
}
