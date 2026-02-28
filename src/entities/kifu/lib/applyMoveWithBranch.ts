import { JKFPlayer } from "json-kifu-format";
import type {
  IMoveMoveFormat,
  IMoveFormat,
} from "json-kifu-format/dist/src/Formats";
import type { ForkPointer } from "../model/cursor";
import { eqMove } from "./eqMove";

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
  if (nextMove?.move && canMergeMove(jkf, nextMove.move, move)) {
    jkf.forward();
    return buildResult(jkf, true, false);
  }

  // 2) 既存変化合流
  const nextMoveWithForks = jkf.currentStream[curTesuu + 1];
  if (nextMoveWithForks?.forks) {
    for (let i = 0; i < nextMoveWithForks.forks.length; i++) {
      const forkLine = nextMoveWithForks.forks[i];
      const forkFirst = forkLine?.[0];
      if (forkFirst?.move && canMergeMove(jkf, forkFirst.move, move)) {
        jkf.forkAndForward(i);
        return buildResult(jkf, true, false);
      }
    }
  }

  // 3) 新規追加
  jkf.inputMove(move);
  return buildResult(jkf, false, true);
}

function canMergeMove(
  jkf: JKFPlayer,
  existing: IMoveMoveFormat,
  incoming: IMoveMoveFormat,
): boolean {
  if (!eqMove(existing, incoming)) return false;

  // "from なし" 同士は「駒打ち」と「移動元省略の指し手」が衝突することがある。
  // 入力手(駒打ち)の着手先へ同種駒を盤上から動かせるなら、誤合流を避けるため
  // 既存手への合流を行わず、新規分岐として追加する。
  if (!existing.from && !incoming.from && isAmbiguousDropLikeMove(jkf, incoming)) {
    return false;
  }

  return true;
}

function isAmbiguousDropLikeMove(jkf: JKFPlayer, move: IMoveMoveFormat): boolean {
  if (move.from || !move.to) return false;
  return jkf.shogi.getMovesTo(move.to.x, move.to.y, move.piece, move.color).length > 0;
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
