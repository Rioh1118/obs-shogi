import type { JKFPlayer } from "json-kifu-format";
import type { KifuCursor } from "../model/cursor";
import { buildPlayer } from "./buildPlayer";

export function computeLeafTesuu(player: JKFPlayer, cursor: KifuCursor | null): number {
  const sim = buildPlayer(player.kifu, cursor);
  // cursor が無いときは、渡された player の現在地から数える。
  if (!cursor) sim.goto(player.tesuu);

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
