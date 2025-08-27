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
  const forks = getForksAtCurrentPosition(jkf, curTesuu + 1);

  if (forks && forks.length > 0) {
    // forksの各分岐をチェック
    for (let i = 0; i < forks.length; i++) {
      const forkMove = forks[i];
      if (forkMove?.move && eqMove(forkMove.move, move)) {
        // この分岐に切り替えて進む
        selectForkAndForward(jkf, curTesuu, i);
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
 * 現在位置でのforks配列を取得
 */
function getForksAtCurrentPosition(
  jkf: JKFPlayer,
  tesuu: number,
): IMoveFormat[] | undefined {
  // 現在のストリームから該当手数の手を取得
  const currentMoveData = jkf.currentStream[tesuu];

  if (!currentMoveData) return undefined;

  // その手にforksがあれば返す
  if (currentMoveData.forks) {
    // forks配列の各分岐の初手を返す
    return currentMoveData.forks.map((fork) => fork[0]).filter(Boolean);
  }

  // 本譜での分岐を探す場合
  const mainMove = jkf.kifu.moves[tesuu];
  if (mainMove?.forks) {
    return mainMove.forks.map((fork) => fork[0]).filter(Boolean);
  }

  return undefined;
}

/**
 * 指定した分岐に切り替えて1手進む
 */
function selectForkAndForward(
  jkf: JKFPlayer,
  tesuu: number,
  forkIndex: number,
): void {
  // 該当手数に移動
  jkf.goto(tesuu);

  // forkAndForwardは1-indexxedなので調整が必要
  jkf.forkAndForward(forkIndex + 1);
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
