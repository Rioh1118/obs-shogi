import { JKFPlayer } from "json-kifu-format";
import type {
  IMoveMoveFormat,
  IMoveFormat,
} from "json-kifu-format/dist/src/Formats";
import { eqMove } from "@/utils/eqMove";

export type ApplyMoveResult = {
  /** 既存の手（本譜 or 既存分岐）を使ったか */
  usedExisting: boolean;
  /** 新規分岐を作ったか（= inputMove したか） */
  createdNew: boolean;
  /** 適用後の tesuu（jkf.tesuu） */
  tesuu: number;
  /** 適用後の分岐インデックスのパス*/
  currentPath: number[];
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

  // 次の手を取得
  const nextMove = getNextMove(jkf, curTesuu);

  // 1. 次の手が存在し、同じ手であればforward
  if (nextMove?.move && eqMove(nextMove.move, move)) {
    jkf.forward();
    return {
      usedExisting: true,
      createdNew: false,
      tesuu: jkf.tesuu,
      currentPath: getCurrentPath(jkf),
    };
  }

  // 2. 次の位置のforksをチェック
  const nextMoveWithForks = jkf.currentStream[curTesuu + 1];

  if (nextMoveWithForks?.forks) {
    // forksの各分岐をチェック
    for (let i = 0; i < nextMoveWithForks.forks.length; i++) {
      const fork = nextMoveWithForks.forks[i];
      // 分岐の最初の手を取得
      const forkFirstMove = fork[0];
      if (forkFirstMove?.move && eqMove(forkFirstMove.move, move)) {
        // この分岐に切り替えて進む
        jkf.forkAndForward(i);
        return {
          usedExisting: true,
          createdNew: false,
          tesuu: jkf.tesuu,
          currentPath: getCurrentPath(jkf),
        };
      }
    }
  }

  // 3. どこにも見つからなければ新規追加
  jkf.inputMove(move);
  return {
    usedExisting: false,
    createdNew: true,
    tesuu: jkf.tesuu,
    currentPath: getCurrentPath(jkf),
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

/**
 * 現在の分岐パスを取得
 */
function getCurrentPath(jkf: JKFPlayer): number[] {
  // JKFPlayerのgetForkPointers()を使用
  const forkPointers = jkf.getForkPointers ? jkf.getForkPointers() : [];

  // ForkPointer[]から分岐インデックスの配列に変換
  return forkPointers.map((fp) => fp.forkIndex);
}
