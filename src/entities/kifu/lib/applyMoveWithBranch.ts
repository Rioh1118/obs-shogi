import { JKFPlayer, Normalizer } from "json-kifu-format";
import type { IMoveMoveFormat, IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { ForkPointer } from "../model/cursor";
import { eqMove } from "./eqMove";

export type ApplyMoveResult = {
  /** 既存の手（本譜 or 既存分岐）を使ったか */
  usedExisting: boolean;
  /** 棋譜に新しい分岐を1本足したか */
  createdNew: boolean;
  /** 適用後の手数 */
  tesuu: number;

  /** 現在ルートの分岐選択の履歴 */
  forkPointers: ForkPointer[];
};

/**
 * 現在の局面に move を適用する。
 * 1. 同じ手が本譜にあれば forward()
 * 2. 同じ手が forks[1..] にあれば forkAndForward()
 * 3. 無ければ新規分岐として追加
 *
 * 渡した `move` は棋譜が所有する。コピーせずそのまま収まり、正規化が
 * `color` / `piece` / `same` / `capture` / `promote` / `relative` を書き加える。しかも正規化は棋譜全体に
 * 走るので、後から別の分岐を足したときにも書き換わる。呼び出し側は同じオブジェクトを
 * 使い回さないこと。3 の経路も末端の `inputMove` も同じ。
 */
export function applyMoveWithBranch(player: JKFPlayer, move: IMoveMoveFormat): ApplyMoveResult {
  const curTesuu = player.tesuu;

  // 1) 本線合流
  const nextFormat = getNextMoveFormat(player, curTesuu);
  if (nextFormat?.move && eqMove(nextFormat.move, move)) {
    player.forward();
    return buildResult(player, true, false);
  }

  // 2) 既存変化合流
  if (nextFormat?.forks) {
    for (let i = 0; i < nextFormat.forks.length; i++) {
      const forkLine = nextFormat.forks[i];
      const forkFirst = forkLine?.[0];
      if (forkFirst?.move && eqMove(forkFirst.move, move)) {
        player.forkAndForward(i);
        return buildResult(player, true, false);
      }
    }
  }

  // 3) 新規追加
  //
  // 注意: player.inputMove() は内部で JKFPlayer.sameMoveMinimal を使うが、
  // この関数は「片方だけ from がある」ケースで piece のみ比較するため
  // 例: 既存「3九金(49)」(from あり) と 入力「3九金打」(from なし) を同一視し、
  // forward() して既存手へ合流させてしまう（issue #74）。
  // 上の 1)/2) では from の有無の非対称を厳密に判定する eqMove を使っており、
  // ここに到達した時点で「新規分岐として追加すべき手」が確定している。
  // そのため inputMove は使わず、JKF データを直接編集して fork を追加する。
  if (nextFormat) {
    if (!nextFormat.forks) {
      nextFormat.forks = [];
    }
    const newForkIndex = nextFormat.forks.length;
    nextFormat.forks.push([{ move }]);
    // 表記もここに依存している。相対表記が埋まらないと、分岐一覧で
    // 「3九金(49)」と「3九金打」が同じ文字列になり読み分けられない。
    Normalizer.normalizeMinimal(player.kifu);
    player.forkAndForward(newForkIndex);
    return buildResult(player, false, true);
  }

  // 末端（次手が存在しない）の場合は inputMove が安全（バグ箇所に到達しない）
  player.inputMove(move);
  return buildResult(player, false, true);
}

function buildResult(
  player: JKFPlayer,
  usedExisting: boolean,
  createdNew: boolean,
): ApplyMoveResult {
  const fps = (player.getForkPointers?.() ?? []) as ForkPointer[];
  return {
    usedExisting,
    createdNew,
    tesuu: player.tesuu,
    forkPointers: fps,
  };
}

/**
 * 現在の手順での次の手 (moveFormat) を取得
 */
function getNextMoveFormat(player: JKFPlayer, tesuu: number): IMoveFormat | undefined {
  const currentStream = player.currentStream;

  if (!currentStream || tesuu + 1 >= currentStream.length) {
    return undefined;
  }

  return currentStream[tesuu + 1];
}
