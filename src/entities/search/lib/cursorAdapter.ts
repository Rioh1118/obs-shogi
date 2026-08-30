import { normalizeForkPointers, type CursorPath } from "@/entities/kifu/model/cursor";
import type { CursorLite } from "../api/ids";

/**
 * Rust の索引が返すカーソルを、盤を辿るのに使える形にする。
 *
 * 索引側は `fork_pointers` の並びを保証しないので `normalizeForkPointers` を通す。
 * 通さないと、同じ局面が並び順の違いだけで別の経路として `buildPlayer` に渡る。
 *
 * **索引のカーソルは「辿った経路」であって分岐計画ではない。** Rust 側は分岐点
 * （`te == tesuu`）でしか `fork_path` を伸ばさないので `te > tesuu` を含まず、
 * ここの正規化がそれを型の手前で保証する。
 *
 * `tesuuPointer` を持たないのは、索引を張った時点の棋譜に対する値であって、
 * いま開いているファイルの上でその局面に着ける保証が無いため。局面の同一性が
 * 要る側は、辿り着いた player から `cursorFromPlayer` で作ること。
 */
export function cursorFromLite(c: CursorLite): CursorPath {
  return {
    tesuu: c.tesuu,
    forkPointers: normalizeForkPointers(
      c.forkPointers.map((p) => ({ te: p.te, forkIndex: p.forkIndex })),
      c.tesuu,
    ),
  };
}
