import { normalizeForkPointers, type CursorPath } from "@/entities/kifu/model/cursor";
import type { CursorLite } from "../api/ids";

/**
 * Rust の索引が返すカーソルを、盤を辿るのに使える形にする。
 *
 * 索引はいま te 昇順・te 一意で組む（`src-tauri/src/search/index/index_builder.rs` の
 * `push_or_replace_fork` が push のたびに `sort_by_key` する）ので、この正規化は
 * 現物に対しては no-op。それでも通すのは、ワイヤ越しに来る `CursorLite` を
 * `CursorPath` の前提（整列済み・`te <= tesuu`）へ合わせる関門を1つに保つため。
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
