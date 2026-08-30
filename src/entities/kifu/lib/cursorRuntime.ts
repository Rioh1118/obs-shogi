import type { JKFPlayer } from "json-kifu-format";
import {
  asBranchPlan,
  cursorFromSource,
  normalizeForkPointers,
  type BranchPlan,
  type ForkPointer,
  type KifuCursor,
} from "../model/cursor";

/**
 * 再生し終えた player から `KifuCursor` を作る。
 *
 * `model/cursor.ts` の `cursorFromSource` に `JKFPlayer` を差す口。型の側が
 * `JKFPlayer` クラスに依存しないよう、具体の依存はこちらに寄せてある。
 */
export function cursorFromPlayer(player: JKFPlayer): KifuCursor {
  return cursorFromSource({
    tesuu: player.tesuu,
    getForkPointers: (tesuu?: number) => player.getForkPointers(tesuu),
    getTesuuPointer: (tesuu?: number) => player.getTesuuPointer(tesuu),
  });
}

/**
 * 辿ったカーソルと、カーソルより先の計画を合成する。
 *
 * `prevPlan` / `overridePlan` を `fp.te > cursor.tesuu` で絞るのは、
 * 「`branchPlan` の `te <= cursor.tesuu` の部分は `cursor.forkPointers` と一致する」
 * （`docs/state-transitions/game.md` の不変条件1）を、この関数を通る書き込み経路が
 * 守るため。他の経路は空にするか `cursor.forkPointers` をそのまま写して守っている。
 */
export function mergeBranchPlan(
  cursor: KifuCursor,
  prevPlan: ForkPointer[],
  overridePlan?: ForkPointer[],
): BranchPlan {
  return asBranchPlan(
    normalizeForkPointers([
      ...cursor.forkPointers,
      ...prevPlan.filter((fp) => fp.te > cursor.tesuu),
      ...(overridePlan ?? []).filter((fp) => fp.te > cursor.tesuu),
    ]),
  );
}

export function sameForkPointers(a: ForkPointer[], b: ForkPointer[]) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.te === b[i]?.te && x.forkIndex === b[i]?.forkIndex);
}
