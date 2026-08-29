import type { JKFPlayer } from "json-kifu-format";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { BranchOption } from "../model/branch";

/**
 * 現在の局面から指せる分岐の候補を返す
 *
 * `options[0]` は必ず本譜。以降は `forks` の並び順で、`forkIndex` は `forks` の添字と一致する。
 * 投了・中断だけの変化も落とさない。落とすと棋譜ストリームの分岐メニューと項目数が食い違う。
 */
export function buildNextOptions(sim: JKFPlayer): BranchOption[] {
  const cur = sim.tesuu;
  const next: IMoveFormat | undefined = sim.currentStream?.[cur + 1];
  if (!next) return [];

  const options: BranchOption[] = [];

  options.push({
    isMainLine: true,
    tesuu: cur + 1,
    moveFormat: next,
  });

  if (next.forks) {
    next.forks.forEach((forkLine, i) => {
      // JKFData は parse の出口で空の変化を落としてある（sanitizeJkf）。
      // ここは JKF を手で組む経路への保険。
      const forkFirst = forkLine?.[0];
      if (!forkFirst) return;

      options.push({
        isMainLine: false,
        tesuu: cur + 1,
        moveFormat: forkFirst,
        forkIndex: i,
      });
    });
  }
  return options;
}
