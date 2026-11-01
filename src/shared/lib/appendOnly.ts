/**
 * 前に見たところまでが、いまの並びの先頭とそのまま一致しているかを返す。
 *
 * 真なら `consumed` 番目から末尾までが新着で、偽なら先頭から作り直す。
 *
 * 末尾の1つしか見ないので、追記しかしないと言い切れる列にだけ使う。
 * 中間の要素が差し替わる並びでも、長さと `consumed - 1` 番目が合えば真を返し、**古い並びを黙って返し続ける**。
 *
 * 要素の一致は参照で見る。局面検索のヒットのように、届いた実体をそのまま保つ列を想定している。
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
