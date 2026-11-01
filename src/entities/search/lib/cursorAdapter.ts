import { normalizeForkPointers, type CursorPath } from "@/entities/kifu/model/cursor";
import type { CursorLite } from "../api/ids";

/**
 * Rust の索引が返すカーソルを、盤を辿るのに使える形にする。
 *
 * 索引は te 昇順、te 一意で組む（`index_builder.rs` の `push_or_replace_fork`）ので、
 * いまの正規化は値を変えない。それでも通すのは、線から来る `CursorLite` を `CursorPath` の
 * 前提（整列済み、`te <= tesuu`）へ合わせる関数を1つに保つため。
 *
 * 索引のカーソルは辿った経路で、分岐計画ではない。Rust は分岐点（`te == tesuu`）でしか
 * `fork_path` を伸ばさないので `te > tesuu` を含まず、正規化がそれを保証する。
 *
 * `tesuuPointer` を持たないのは、索引を張った時点の棋譜の値で、開いているファイルの上で
 * その局面に着く保証が無いため。局面の同一性が要る側は、辿り着いた player から
 * `cursorFromPlayer` で作ること。
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
