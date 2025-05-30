import { Shogi, Color, type IMove, type Kind } from "shogi.js";

export class LegalMoveGenerator {
  /**
   * 王手判定
   */
  static isInCheck(shogi: Shogi, color: Color): boolean {
    return shogi.isCheck(color);
  }

  /**
   * 特定の手が王手放置になるかチェック
   * SFENを使った状態保存・復元アプローチ
   */
  static wouldBeInCheckAfterMove(shogi: Shogi, move: IMove): boolean {
    try {
      // 現在の局面をSFENで保存
      const currentSfen = shogi.toSFENString();

      const testShogi = new Shogi();
      testShogi.initializeFromSFENString(currentSfen);

      if (move.from) {
        testShogi.move(move.from.x, move.from.y, move.to.x, move.to.y, false);
      } else {
        testShogi.drop(move.to.x, move.to.y, move.kind!, move.color);
      }

      const movingColor =
        move.color ||
        (move.from
          ? testShogi.turn === Color.Black
            ? Color.White
            : Color.Black
          : move.color!);

      return testShogi.isCheck(movingColor);
    } catch (_) {
      return true;
    }
  }

  /**
   * 特定の位置からの合法手(王手放置チェック付き)
   * これがメインの実装対象
   */
  static getLegalMovesFrom(shogi: Shogi, x: number, y: number): IMove[] {
    const piece = shogi.get(x, y);
    if (!piece) return [];

    const basciMoves = shogi.getMovesFrom(x, y);

    return basciMoves.filter(
      (move) => !this.wouldBeInCheckAfterMove(shogi, move),
    );
  }

  private static hasFuInColumn(
    shogi: Shogi,
    column: number,
    color: Color,
  ): boolean {
    for (let y = 1; y <= 9; y++) {
      const piece = shogi.get(column, y);
      if (piece && piece.color === color && piece.kind === "FU") {
        return true;
      }
    }
    return false;
  }

  private static canDropFu(
    shogi: Shogi,
    x: number,
    y: number,
    color: Color,
  ): boolean {
    if (this.hasFuInColumn(shogi, x, color)) {
      return false;
    }

    const prohibitedRow = color === 0 ? 1 : 9;
    if (y === prohibitedRow) {
      return false;
    }

    return true;
  }

  private static canDropKe(x: number, y: number, color: Color): boolean {
    const prohibitedRows = color === 0 ? [1, 2] : [8, 9];
    return !prohibitedRows.includes(y);
  }

  private static canDropKy(x: number, y: number, color: Color): boolean {
    const prohibitedRow = color === 0 ? 1 : 9;
    return y !== prohibitedRow;
  }

  private static canDropPieceAt(
    shogi: Shogi,
    kind: string,
    x: number,
    y: number,
    color: Color,
  ): boolean {
    switch (kind) {
      case "FU":
        return this.canDropFu(shogi, x, y, color);
      case "KE":
        return this.canDropKe(x, y, color);
      case "KY":
        return this.canDropKy(x, y, color);
      case "GI":
      case "KI":
      case "KA":
      case "HI":
        return true; // これらの駒は基本的にどこでも打てる
      default:
        return false;
    }
  }

  private static getEmptySquares(
    shogi: Shogi,
  ): Array<{ x: number; y: number }> {
    const emptySquares: Array<{ x: number; y: number }> = [];
    for (let x = 1; x <= 9; x++) {
      for (let y = 1; y <= 9; y++) {
        if (shogi.get(x, y) === null) {
          emptySquares.push({ x, y });
        }
      }
    }
    return emptySquares;
  }

  /**
   * 指定した駒種のみの打ち手を生成
   */
  static getLegalDropsByKind(shogi: Shogi, color: Color, kind: Kind): IMove[] {
    const hands = shogi.getHandsSummary(color);

    // 型安全な方法で持ち駒をチェック
    const pieceCount = hands[kind as keyof typeof hands] || 0;
    if (pieceCount === 0) {
      return [];
    }

    const ret: IMove[] = [];
    const emptySquares = this.getEmptySquares(shogi);

    for (const square of emptySquares) {
      // 駒種別の制約チェック
      if (!this.canDropPieceAt(shogi, kind, square.x, square.y, color)) {
        continue;
      }

      ret.push({
        to: square,
        color,
        kind,
      });
    }

    // 王手放置チェック
    return ret.filter((move) => !this.wouldBeInCheckAfterMove(shogi, move));
  }
}
