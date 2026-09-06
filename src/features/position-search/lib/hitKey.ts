import { cursorFromLite } from "@/entities/search";
import type { PositionHit } from "@/entities/search";
import { cursorKey } from "@/entities/kifu/model/cursor";

/**
 * ヒットの同一性。索引の位置（file / gen / node）とカーソルの組。
 *
 * カーソル側の直列化は `cursorFromLite` → `cursorKey` に任せる。ここで自前に
 * 組み直すと、鍵の書式が2つになる。
 *
 * **一覧を追いかけるのに使わない。** 1件 0.5〜2.7µs（`normalizeForkPointers` を
 * 2回通して `JSON.stringify` する）なので、件数ぶん組むと止まる。ヒットの実体は
 * セッション中に作り直されないので、並びを追うのは参照で足りる
 * （`useOrderedPositionHits` / `PositionSearchModal`）。ここが要るのは
 * **描画をまたいで覚えておきたいとき**だけ——断りを付けた行など。
 */
export const hitKey = (h: PositionHit) =>
  `${h.occ.fileId}:${h.occ.gen}:${h.occ.nodeId}:${cursorKey(cursorFromLite(h.cursor))}`;
