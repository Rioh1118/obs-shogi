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
    id: `te${cur + 1}-main`,
    isMainLine: true,
    tesuu: cur + 1,
    moveFormat: next,
  });

  if (next.forks) {
    next.forks.forEach((forkLine, i) => {
      // 空の変化は tsshogi の出口では作れないが、JKF を手で組む経路への保険。
      const forkFirst = forkLine?.[0];
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
