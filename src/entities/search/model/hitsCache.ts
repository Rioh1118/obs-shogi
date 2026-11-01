import { isAppendOnlyContinuation } from "@/shared/lib/appendOnly";

import type { PositionHit, RequestId } from "../api/ids";

type HitsCacheEntry = {
  /**
   * 直前に取り込んだチャンクの実体。
   *
   * **チャンクを入れている配列の同一性では判定しない。** reducer は到着のたびに
   * `[...s.chunks, ...p.chunks]` で新しい配列へ差し替えるので、同一性で見ると
   * 増分追記は**一度も起きず**、毎回先頭から n 件を作り直すことになる。
   */
  lastChunk: PositionHit[] | null;
  consumed: number;
  /** 追記していく作業用。**呼び手へ渡すのはこれではない** */
  flat: PositionHit[];
  /** 呼び手へ渡した写し。同じ state を見ている間は同じものを返す */
  snapshot: PositionHit[];
};

export type HitsCache = Map<RequestId, HitsCacheEntry>;

export function flattenHits(
  cache: HitsCache,
  requestId: RequestId,
  chunks: PositionHit[][],
): PositionHit[] {
  const entry = cache.get(requestId);

  // 前に取り込んだところまでが、いまの並びの先頭とそのまま一致しているか。
  // 一致していれば末尾だけ足せばよい
  const canAppend = !!entry && isAppendOnlyContinuation(chunks, entry.consumed, entry.lastChunk);

  if (canAppend && entry.consumed === chunks.length) return entry.snapshot;

  const flat = canAppend ? entry.flat : [];
  const start = canAppend ? entry.consumed : 0;
  for (let i = start; i < chunks.length; i++) {
    const chunk = chunks[i];
    for (let j = 0; j < chunk.length; j++) flat.push(chunk[j]);
  }

  // **写しを渡す。** `flat` は増分追記のために同じ配列を伸ばし続けるので、
  // 直に返すと呼び手の `useMemo` が「変わっていない」と読み、
  // **新着ヒットが一覧に出ない**。写しは要素の指し直しだけ（n=100,000 で
  // 0.035ms。`.claude/reviews/2026-09-07-447-position-search-perf-r1.md` M-4）
  // なので、増分追記の意味は消えない
  const snapshot = flat.slice();

  cache.set(requestId, {
    lastChunk: chunks[chunks.length - 1],
    consumed: chunks.length,
    flat,
    snapshot,
  });
  return snapshot;
}
