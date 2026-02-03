import { JKFPlayer } from "json-kifu-format";
import type { KifuCursor } from "@/types";
import { appliedForkPointers } from "./kifuCursor";

export function computeLeafTesuu(
  jkf: JKFPlayer,
  cursor: KifuCursor | null,
): number {
  const sim = new JKFPlayer(jkf.kifu);

  if (cursor) {
    sim.goto(cursor.tesuu, appliedForkPointers(cursor, cursor.tesuu));
  } else {
    sim.goto(jkf.tesuu);
  }

  const plannedMap = new Map<number, number>();
  for (const p of cursor?.forkPointers ?? []) {
    plannedMap.set(p.te, p.forkIndex);
  }

  let limit = 10000;
  while (limit-- > 0) {
    const nextTe = sim.tesuu + 1;

    const forkIndex = plannedMap.get(nextTe);
    if (forkIndex !== undefined) {
      const ok = sim.forkAndForward(forkIndex);
      if (ok) continue; // planned どおり分岐に入れた
      // planned が無効なら本線へフォールバック
    }

    const ok = sim.forward();
    if (!ok) break; // これ以上進めない = 葉
  }

  if (limit <= 0) throw new Error("leaf tesuu overflows");
  return sim.tesuu;
}
