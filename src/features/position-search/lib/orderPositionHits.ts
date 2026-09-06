import { useRef } from "react";

import { cursorFromLite } from "@/entities/search";
import type { PositionHit } from "@/entities/search";
import { cursorKey } from "@/entities/kifu/model/cursor";

/**
 * ヒットの同一性。索引の位置（file / gen / node）とカーソルの組。
 *
 * カーソル側の直列化は `cursorFromLite` → `cursorKey` に任せる。ここで自前に
 * 組み直すと、鍵の書式が2つになる。
 */
export const hitKey = (h: PositionHit) =>
  `${h.occ.fileId}:${h.occ.gen}:${h.occ.nodeId}:${cursorKey(cursorFromLite(h.cursor))}`;

/**
 * 振り分けの途中経過。
 *
 * `consumed` 件目までは `same` / `other` のどちらかに入っている。`lastHit` は
 * その最後の1件で、**並びの先頭が前と同じかを確かめるのに使う**——一覧は
 * 末尾へ増えるだけなので、そこが一致していれば残りを足すだけでよい。
 */
type OrderCache = {
  currentAbs: string | null;
  consumed: number;
  lastHit: PositionHit | null;
  same: PositionHit[];
  other: PositionHit[];
  ordered: PositionHit[];
};

/**
 * 開いている棋譜のヒットを先頭へ寄せる。元の相対順序は保つ。
 *
 * **新しく届いたぶんだけ振り分ける。** 一覧はチャンクが届くたびに伸びるので、
 * 毎回全件を走らせると `resolveAbsPath` の呼び出しが二乗で伸びる（実測で
 * n=100,000 のとき合計 2,357ms）。
 *
 * **振り分けは、そのヒットが届いた時点のパスで決まる。** 後からパスが入っても
 * 振り分け直さない。Rust はヒットと同じチャンクにそのファイルの `files` を
 * 載せて emit する（`src-tauri/src/search/query_service.rs`）ので、届いた時点で
 * 引けないパスは索引の側の欠けであり、同じ検索のあいだは埋まらない。
 */
export function useOrderedPositionHits(
  hits: PositionHit[],
  resolveAbsPath: (hit: PositionHit) => string | null,
  currentAbs: string | null,
): PositionHit[] {
  const cacheRef = useRef<OrderCache>({
    currentAbs: null,
    consumed: 0,
    lastHit: null,
    same: [],
    other: [],
    ordered: [],
  });

  // 開いている棋譜が無ければ寄せる先が無い。並びは索引の順のまま
  if (!currentAbs) return hits;

  const cache = cacheRef.current;

  const canAppend =
    cache.currentAbs === currentAbs &&
    cache.consumed <= hits.length &&
    (cache.consumed === 0 || hits[cache.consumed - 1] === cache.lastHit);

  if (canAppend && cache.consumed === hits.length) return cache.ordered;

  if (!canAppend) {
    cache.currentAbs = currentAbs;
    cache.consumed = 0;
    cache.same = [];
    cache.other = [];
  }

  for (let i = cache.consumed; i < hits.length; i++) {
    const hit = hits[i];
    const abs = resolveAbsPath(hit);
    if (abs && abs === currentAbs) cache.same.push(hit);
    else cache.other.push(hit);
  }

  cache.consumed = hits.length;
  cache.lastHit = hits[hits.length - 1] ?? null;
  cache.ordered = [...cache.same, ...cache.other];

  return cache.ordered;
}
