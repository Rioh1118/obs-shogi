import {
  wouldBeInCheckAfterMove,
  canDropPieceAt,
  canPromote,
  mustPromote,
  getAllPossibleMoves,
} from "./moveValidation";
import type { MoveValidator } from "../model/moveValidator";
import type { Color, Kind, Shogi } from "shogi.js";
import type { ShogiMove } from "../model/types";

export class ShogiMoveValidator implements MoveValidator {
  /**
   * 基本的な合法手チェック
   */
  isLegalMove(shogi: Shogi, move: ShogiMove): boolean {
    try {
      if (move.from) {
        const legalMoves = this.getLegalMovesFrom(
          shogi,
          move.from.x,
          move.from.y,
        );
        return legalMoves.some(
          (legal) => legal.to.x === move.to.x && legal.to.y === move.to.y,
        );
      } else {
        if (!move.color || !move.kind) return false;

        const legalDrops = this.getLegalDropsByKind(
          shogi,
          move.color,
          move.kind,
        );

        return legalDrops.some(
          (legal) => legal.to.x === move.to.x && legal.to.y === move.to.y,
        );
      }
    } catch {
      return false;
    }
  }

  /**
   * 全ての合法手を取得
   * utilsのgetAllPossibleMovesを委譲
   */
  getAllLegalMoves(shogi: Shogi, color: Color): ShogiMove[] {
    return getAllPossibleMoves(shogi, color);
  }

  /**
   * 指定位置からの合法手を取得
   * shogi.getMovesFrom()を使用 + 王手放置チェック
   */
  getLegalMovesFrom(shogi: Shogi, x: number, y: number): ShogiMove[] {
    const piece = shogi.get(x, y);
    if (!piece) return [];

    const basicMoves = shogi.getMovesFrom(x, y);
    return basicMoves.filter((move) => !wouldBeInCheckAfterMove(shogi, move));
  }

  /**
   * 指定した駒種の駒打ち合法手取得
   * shogi.getDropsBy()を使用 + 駒種フィルタ + 制約チェック + 王手放置チェック
   */
  getLegalDropsByKind(shogi: Shogi, color: Color, kind: Kind): ShogiMove[] {
    const hands = shogi.getHandsSummary(color);
    const pieceCount = hands[kind as keyof typeof hands] || 0;
    if (pieceCount == 0) return [];

    // 全ての駒打ち手を取得
    const allDrops = shogi.getDropsBy(color);

    // 指定駒種でフィルタ + 制約チェック + 王手放置チェック
    return allDrops
      .filter((move) => move.kind === kind)
      .filter((move) =>
        canDropPieceAt(shogi, kind, move.to.x, move.to.y, color),
      )
      .filter((move) => !wouldBeInCheckAfterMove(shogi, move));
  }

  /**
   * 成り可能チェック
   */
  canPromote(shogi: Shogi, move: ShogiMove): boolean {
    return canPromote(shogi, move);
  }

  /**
   * 強制成りチェック
   */
  mustPromote(shogi: Shogi, move: ShogiMove): boolean {
    return mustPromote(shogi, move);
  }

  /**
   * 成り・不成の選択肢を含む合法手を取得
   */
  getLegalMovesWithPromotionOptions(
    shogi: Shogi,
    x: number,
    y: number,
  ): Array<{ move: ShogiMove; canPromote: boolean; mustPromote: boolean }> {
    const basicMoves = this.getLegalMovesFrom(shogi, x, y);
    return basicMoves.map((move) => ({
      move,
      canPromote: canPromote(shogi, move),
      mustPromote: mustPromote(shogi, move),
    }));
  }
}
