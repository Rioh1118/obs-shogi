import type { PreviewData } from "@/entities/position/model/preview";
import type { BranchOption } from "@/entities/kifu/model/branch";
import type { JKFPlayer } from "json-kifu-format";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";

export function buildPreviewData(jkf: JKFPlayer, nodeId: string): PreviewData {
  const shogi = jkf.shogi;

  const toKindList = (color: 0 | 1): string[] => {
    const pieces = shogi.hands?.[color] ?? [];
    return pieces.map((p) => p?.kind);
  };

  return {
    board: shogi.board,
    hands: {
      0: toKindList(0),
      1: toKindList(1),
    },
    tesuu: jkf.tesuu,
    turn: shogi.turn,
    nodeId,
  };
}

export function buildNextOptions(sim: JKFPlayer): BranchOption[] {
  const cur = sim.tesuu;
  const next: IMoveFormat | undefined = sim.currentStream?.[cur + 1];
  if (!next) return [];

  const options: BranchOption[] = [];

  options.push({
    id: `te${cur + 1}-main`,
    isMainLine: true,
    tesuu: cur + 1,
    moveFormat: next,
  });

  if (next.forks) {
    next.forks.forEach((forkLine, i) => {
      const forkFirst = forkLine?.[0];
      // 投了だけの変化も落とさない。落とすと forkIndex と表示上の番号がずれる。
      if (!forkFirst) return;

      options.push({
        id: `te${cur + 1}-fork${i}`,
        isMainLine: false,
        tesuu: cur + 1,
        moveFormat: forkFirst,
        forkIndex: i,
      });
    });
  }
  return options;
}
