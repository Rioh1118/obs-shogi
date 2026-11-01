import { isAppendOnlyContinuation } from "@/shared/lib/appendOnly";

import type { PositionHit, RequestId } from "../api/ids";

/** 1つの検索の平坦化の途中経過 */
type HitsCacheEntry = {
  /**
   * 直前に取り込んだチャンクの実体。
   *
   * `chunks` の配列の同一性では比べない。reducer が到着のたびに新しい配列へ差し替えるので、
   * 増分の追記が一度も起きなくなる。
   */
  lastChunk: PositionHit[] | null;
  consumed: number;
  /** 追記していく作業用の配列。呼び手へは渡さない */
  flat: PositionHit[];
  /** 呼び手へ渡した写し。同じ到着分を見ている間は同じものを返す */
  snapshot: PositionHit[];
};

/** 検索ごとの平坦化の結果。`PositionSearchProvider` が描画をまたいで持つ */
export type HitsCache = Map<RequestId, HitsCacheEntry>;

/**
 * チャンクの列を平らにして返す。届いた分が増えたら末尾だけを追記する（償却 O(n)）。
 *
 * 同じ到着分には同じ配列を返し、増えたら別の配列を返す。呼び手の `useMemo` はこの同一性で
 * 増えたかを読むので、常に別の配列だと memo が毎回外れ、常に同じ配列だと増えたことが伝わらない。
 */
export function flattenHits(
  cache: HitsCache,
  requestId: RequestId,
  chunks: PositionHit[][],
): PositionHit[] {
  const entry = cache.get(requestId);

  // 前に取り込んだところまでが同じ並びなら、末尾だけ足せばよい
  const canAppend = !!entry && isAppendOnlyContinuation(chunks, entry.consumed, entry.lastChunk);

  if (canAppend && entry.consumed === chunks.length) return entry.snapshot;

  const flat = canAppend ? entry.flat : [];
  const start = canAppend ? entry.consumed : 0;
  for (let i = start; i < chunks.length; i++) {
    const chunk = chunks[i];
    for (let j = 0; j < chunk.length; j++) flat.push(chunk[j]);
  }

  // 写しを渡す。`flat` は同じ配列を伸ばし続けるので、直に返すと呼び手の `useMemo` が変化を読めず、
  // 新着が一覧に出ない。写しの費用は n=100,000 で 0.035ms の実測
  const snapshot = flat.slice();

  cache.set(requestId, {
    lastChunk: chunks[chunks.length - 1],
    consumed: chunks.length,
    flat,
    snapshot,
  });
  return snapshot;
}
