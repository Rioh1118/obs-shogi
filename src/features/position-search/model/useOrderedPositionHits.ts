import { useRef } from "react";

import type { PositionHit } from "@/entities/search";
import { isAppendOnlyContinuation } from "@/shared/lib/appendOnly";

/**
 * 振り分けの途中経過
 *
 * `consumed` 件目までは `same` / `other` のどちらかに入っている。`lastHit` は
 * その最後の1件で、並びの先頭が前と同じかを確かめるのに使う。一覧は
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
 * 開いている棋譜のヒットを先頭へ寄せた並びを返す。元の相対順序は保つ。
 *
 * 新しく届いたぶんだけを振り分ける。一覧はチャンクが届くたびに伸びるので、
 * 毎回全件を走らせると `resolveAbsPath` の呼び出しが二乗で伸びる
 * （2026-09-07 の実測で、n=100,000 のとき合計 2,357ms）。
 *
 * 返り値は呼び出しをまたいで共有する配列なので、破壊的に触らないこと。増えていなければ
 * 同じ配列が返り、寄せる先が無いときは引数をそのまま返す。
 *
 * 振り分けはそのヒットが届いた時点のパスで決まり、後からパスが入っても振り分け直さない。
 * Rust はヒットと同じチャンクにそのファイルの `files` を載せて emit する
 * （`src-tauri/src/search/query_service.rs`）ので、届いた時点で引けないパスは
 * 索引の側の欠けであり、同じ検索のあいだは埋まらない。
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
    isAppendOnlyContinuation(hits, cache.consumed, cache.lastHit);

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
  // スプレッドで繋がない。同じ結果を同じ計算量で出すが、iterator を回すぶん遅い
  // （2026-09-07 の実測で、n=100,000 のとき 1.370ms 対 0.114ms）。
  // ここは新着が1件でも通るので、届いた回数ぶん効く
  cache.ordered = cache.same.concat(cache.other);

  return cache.ordered;
}
