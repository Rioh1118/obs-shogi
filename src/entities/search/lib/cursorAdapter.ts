import type { CursorLite } from "@/commands/search/types";
import type { KifuCursor, TesuuPointer } from "@/entities/kifu/model/cursor";

export function cursorFromLite(c: CursorLite): KifuCursor {
  const forkPointers = c.fork_pointers.map((p) => ({
    te: p.te,
    forkIndex: p.fork_index,
  }));

  // JKFPlayerの文字列形式に寄せる（例: "7,[{"te":3,"forkIndex":0}]")
  const tesuuPointer =
    `${c.tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;

  return {
    tesuu: c.tesuu,
    forkPointers,
    tesuuPointer,
  };
}
