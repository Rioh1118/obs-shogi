import type { CursorLite } from "@/commands/search/types";
import { type ForkPointer, type KifuCursor, type TesuuPointer } from "@/types";
import { JKFPlayer } from "json-kifu-format";

export function appliedForkPointers(
  cursor: KifuCursor | null,
  tesuu: number,
): ForkPointer[] {
  const map = new Map<number, ForkPointer>();
  for (const p of cursor?.forkPointers ?? []) {
    if (p.te <= tesuu) map.set(p.te, p);
  }
  return [...map.values()].sort((a, b) => a.te - b.te);
}

export function applyCursorToPlayer(jkf: JKFPlayer, cursor: KifuCursor | null) {
  if (!cursor) return;
  jkf.goto(cursor.tesuu, appliedForkPointers(cursor, cursor.tesuu));
}

export function mergeForkPointers(
  applied: ForkPointer[],
  prevAll: ForkPointer[] | undefined,
  tesuu: number,
): ForkPointer[] {
  const future = (prevAll ?? []).filter((p) => p.te > tesuu);

  const map = new Map<number, ForkPointer>();
  for (const p of future) map.set(p.te, p);
  for (const p of applied) map.set(p.te, p);

  return [...map.values()].sort((a, b) => a.te - b.te);
}

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
