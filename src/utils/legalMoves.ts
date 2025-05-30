import { Shogi, type IMove, type Color, type Kind } from "shogi.js";

export const filterLegalMoves = (
  moves: IMove[],
  currentSFEN: string,
): IMove[] => {
  return moves.filter((move) => {
    try {
      const tempShogi = new Shogi();
      tempShogi.initializeFromSFENString(currentSFEN);

      tempShogi.move(move.from!.x, move.from!.y, move.to.x, move.to.y);

      const isInCheck = tempShogi.isCheck(tempShogi.turn);

      return !isInCheck;
    } catch (_) {
      return false;
    }
  });
};

/**
 * 2歩と王手放置をチェックして合法な駒打ちのみをフィルタリング
 */
export const filterLegalDrops = (
  moves: IMove[],
  currentSFEN: string,
  kind: Kind,
  color: Color,
): IMove[] => {
  return moves.filter((move) => {
    try {
      // 新しいShogiインスタンスを作成
      const tempShogi = new Shogi();
      tempShogi.initializeFromSFENString(currentSFEN);

      // 一時的に駒を打つ
      tempShogi.drop(move.to.x, move.to.y, kind, color);

      // 王手放置チェック
      const isInCheck = tempShogi.isCheck(tempShogi.turn);

      return !isInCheck;
    } catch (_) {
      // エラーが発生した場合は不正な打ち手（2歩など）
      return false;
    }
  });
};

/**
 * 盤上の駒選択時の合法手を取得
 */
export const getLegalMovesFromSquare = (
  shogi: Shogi,
  x: number,
  y: number,
): IMove[] => {
  const currentSFEN = shogi.toSFENString();
  const basicMoves = shogi.getMovesFrom(x, y);
  return filterLegalMoves(basicMoves, currentSFEN);
};

/**
 * 持ち駒選択時の合法手を取得
 */
export const getLegalDropMoves = (
  shogi: Shogi,
  color: Color,
  kind: Kind,
): IMove[] => {
  const currentSFEN = shogi.toSFENString();
  const basicDrops = shogi.getDropsBy(color);
  return filterLegalDrops(basicDrops, currentSFEN, kind, color);
};
