import { isUsableFork } from "../model/jkf";
import type { JKFData, JKFMove } from "../model/jkf";
import { normalizeForkPointers, type ForkPointer } from "../model/cursor";

/** `startTe` は `line[0]` に対応する絶対手数。`forkPointers` の te も絶対手数。 */
export type LineRef = { line: JKFMove[]; startTe: number };

/**
 * `forkPointers` を順に降りて、`uptoTe` を含む line とその先頭の絶対手数を返す
 *
 * JKF は変化に入るたび手数の原点が動く。`forks[i]` の `[0]` は分岐した te の手であって
 * 0手目ではない。`forkPointers` の te は一貫して絶対手数なので、降りるたびに
 * `startTe` を持ち直して差を取る。この座標系を手書きすると、変化の中の手だけ
 * 1つずれた位置に当たる。
 *
 * `uptoTe` の分岐そのものは降りない。`normalizeForkPointers` の境界は
 * `te <= 第2引数` なので1引いて渡す。`uptoTe` の手を得たい側は `uptoTe` を、
 * `uptoTe` の分岐を選び直したい側も `uptoTe` を渡してよい（前者は返った
 * `line[uptoTe - startTe]`、後者は `forks` を見る）。
 *
 * @throws {Error} `forkPointers` が実在しない変化・中身の無い変化を指すとき
 */
export function resolveLine(kifu: JKFData, forkPointers: ForkPointer[], uptoTe: number): LineRef {
  let line = kifu.moves as JKFMove[];
  let startTe = 0;

  for (const p of normalizeForkPointers(forkPointers, uptoTe - 1)) {
    const idx = p.te - startTe;
    const mv = line[idx];
    if (!isUsableFork(mv?.forks?.[p.forkIndex])) {
      throw new Error(`resolveLine failed at te=${p.te} forkIndex=${p.forkIndex}`);
    }
    line = mv!.forks![p.forkIndex];
    startTe = p.te;
  }

  return { line, startTe };
}
