import type { KifuCursor, TesuuPointer } from "@/entities/kifu/model/cursor";
import type { CursorLite } from "../api/ids";

export function cursorFromLite(c: CursorLite): KifuCursor {
  const forkPointers = c.forkPointers.map((p) => ({
    te: p.te,
    forkIndex: p.forkIndex,
  }));

  // JKFPlayerの文字列形式に寄せる（例: "7,[{"te":3,"forkIndex":0}]")
  const tesuuPointer = `${c.tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;

  return {
    tesuu: c.tesuu,
    forkPointers,
    tesuuPointer,
  };
}
