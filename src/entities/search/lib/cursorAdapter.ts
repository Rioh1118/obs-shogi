import { normalizeForkPointers, type KifuCursor } from "@/entities/kifu/model/cursor";
import { buildTesuuPointer } from "@/entities/kifu/model/cursor";
import type { CursorLite } from "../api/ids";

/**
 * Rust の索引が返すカーソルを `KifuCursor` にする。
 *
 * 索引側は `fork_pointers` の並びを保証しないので、`normalizeForkPointers` を通してから
 * `tesuuPointer` を組む。通さないと、同じ局面が並び順の違いだけで別のキーになり、
 * コメント欄の開閉やカーソル一致の判定がヒットごとに食い違う。
 */
export function cursorFromLite(c: CursorLite): KifuCursor {
  const forkPointers = normalizeForkPointers(
    c.forkPointers.map((p) => ({ te: p.te, forkIndex: p.forkIndex })),
    c.tesuu,
  );

  return {
    tesuu: c.tesuu,
    forkPointers,
    tesuuPointer: buildTesuuPointer(c.tesuu, forkPointers),
  };
}
