import { cursorFromLite } from "@/entities/search";
import type { PositionHit } from "@/entities/search";
import { cursorKey } from "@/entities/kifu/model/cursor";

/**
 * ヒットの同一性。索引の位置（file / gen / node）とカーソルの組。
 *
 * カーソル側の直列化は `cursorFromLite` → `cursorKey` に任せる。ここで自前に
 * 組み直すと、鍵の書式が2つになる。
 *
 * **一覧を追いかけるのに使わない。** 組むのに `normalizeForkPointers` を2回通して
 * `JSON.stringify` するので、件数ぶん組むと止まる。ここが要るのは**描画をまたいで
 * 覚えておきたいとき**だけ——断りを付けた行など。使い分けは
 * `docs/state-transitions/position-search-view.md` の
 * 「選択を追うのは参照、断りを覚えるのは鍵」。
 */
export const hitKey = (h: PositionHit) =>
  `${h.occ.fileId}:${h.occ.gen}:${h.occ.nodeId}:${cursorKey(cursorFromLite(h.cursor))}`;
