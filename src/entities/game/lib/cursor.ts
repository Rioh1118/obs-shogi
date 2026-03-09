import {
  cursorFromSource,
  normalizeForkPointers,
  type ForkPointer,
  type KifuCursor,
} from "@/entities/kifu/model/cursor";
import type { JKFPlayer } from "json-kifu-format";

export function cursorFromPlayer(player: JKFPlayer): KifuCursor {
  return cursorFromSource({
    tesuu: player.tesuu,
    getForkPointers: (tesuu?: number) => player.getForkPointers(tesuu),
    getTesuuPointer: (tesuu?: number) => player.getTesuuPointer(tesuu),
  });
}

export function lastMovePlayer(jkf: JKFPlayer) {
  if (jkf.tesuu === 0) return null;
  const mv = jkf.getMove();
  if (!mv || !mv.to) return null;
  return { from: mv.from, to: mv.to, kind: mv.piece, color: mv.color };
}

export function mergeBranchPlan(
  cursor: KifuCursor,
  prevPlan: ForkPointer[],
  overridePlan?: ForkPointer[],
): ForkPointer[] {
  return normalizeForkPointers([
    ...cursor.forkPointers,
    ...prevPlan.filter((fp) => fp.te > cursor.tesuu),
    ...(overridePlan ?? []).filter((fp) => fp.te > cursor.tesuu),
  ]);
}

export function sameForkPointers(a: ForkPointer[], b: ForkPointer[]) {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) => x.te === b[i]?.te && x.forkIndex === b[i]?.forkIndex,
  );
}
