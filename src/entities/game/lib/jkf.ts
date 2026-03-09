import type { JKFData } from "@/entities/kifu";
import { applyCursorToPlayer } from "@/entities/kifu/lib/cursorRuntime";
import type { KifuCursor } from "@/entities/kifu/model/cursor";
import { JKFPlayer } from "json-kifu-format";

export function cloneJkf(jkf: JKFData): JKFData {
  if (typeof structuredClone === "function") {
    return structuredClone(jkf);
  }
  return JSON.parse(JSON.stringify(jkf)) as JKFData;
}

export function buildPlayer(
  jkf: JKFData,
  cursor: KifuCursor | null,
): JKFPlayer {
  const player = new JKFPlayer(jkf);
  applyCursorToPlayer(player, cursor);
  return player;
}
