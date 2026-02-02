import { JKFPlayer } from "json-kifu-format";
import type {
  IMoveMoveFormat,
  IMoveFormat,
} from "json-kifu-format/dist/src/Formats";
import { eqMove } from "@/utils/eqMove";
import type { ForkPointer } from "@/types/kifu-cursor";

export type ApplyMoveResult = {
  /** 既存の手（本譜 or 既存分岐）を使ったか */
  usedExisting: boolean;
  /** 新規分岐を作ったか（= inputMove したか） */
  createdNew: boolean;
  /** 適用後の tesuu（jkf.tesuu） */
  tesuu: number;

  /** 現在ルートの分岐選択の履歴 */
  forkPointers: ForkPointer[];
};

/**
 * 現在の局面に move を適用する。
 * 1. 同じ手が本譜にあれば forward()
 * 2. 同じ手が forks[1..] にあれば forkAndForward()
 * 3. 無ければ inputMove() で新規分岐を作成
 */
export function applyMoveWithBranch(
  jkf: JKFPlayer,
  move: IMoveMoveFormat,
): ApplyMoveResult {
  const curTesuu = jkf.tesuu;

  // 1) 本線合流
  const nextMove = getNextMove(jkf, curTesuu);
  if (nextMove?.move && eqMove(nextMove.move, move)) {
    jkf.forward();
    return buildResult(jkf, true, false);
  }

  // 2) 既存変化合流
  const nextMoveWithForks = jkf.currentStream[curTesuu + 1];
  if (nextMoveWithForks?.forks) {
    for (let i = 0; i < nextMoveWithForks.forks.length; i++) {
      const forkLine = nextMoveWithForks.forks[i];
      const forkFirst = forkLine?.[0];
      if (forkFirst?.move && eqMove(forkFirst.move, move)) {
        jkf.forkAndForward(i);
        return buildResult(jkf, true, false);
      }
    }
  }

  // 3) 新規追加
  jkf.inputMove(move);
  return buildResult(jkf, false, true);
}

function buildResult(
  jkf: JKFPlayer,
  usedExisting: boolean,
  createdNew: boolean,
): ApplyMoveResult {
  const fps = (jkf.getForkPointers?.() ?? []) as ForkPointer[];
  return {
    usedExisting,
    createdNew,
    tesuu: jkf.tesuu,
    forkPointers: fps,
  };
}

/**
 * 現在の手順での次の手を取得
 * 分岐内にいる場合も考慮
 */
function getNextMove(jkf: JKFPlayer, tesuu: number): IMoveFormat | undefined {
  // JKFPlayerの内部状態から現在のストリームを取得
  const currentStream = jkf.currentStream;

  if (!currentStream || tesuu + 1 >= currentStream.length) {
    return undefined;
  }

  return currentStream[tesuu + 1];
}
