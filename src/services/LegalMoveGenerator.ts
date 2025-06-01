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

    const basicMoves = shogi.getMovesFrom(x, y);

    return basicMoves.filter(
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

  /**
   * 全ての合法手を取得(移動+drop)
   * */
  static getAllLegalMoves(shogi: Shogi, color: Color): IMove[] {
    const moves: IMove[] = [];

    // 盤上の駒からの移動手
    for (let x = 1; x <= 9; x++) {
      for (let y = 1; y <= 9; y++) {
        const piece = shogi.get(x, y);
        if (piece && piece.color === color) {
          moves.push(...this.getLegalMovesFrom(shogi, x, y));
        }
      }
    }
    // 持ち駒からの打ち手
    const hands = shogi.getHandsSummary(color);
    const kinds: Array<"FU" | "KY" | "KE" | "GI" | "KI" | "KA" | "HI"> = [
      "FU",
      "KY",
      "KE",
      "GI",
      "KI",
      "KA",
      "HI",
    ];

    for (const kind of kinds) {
      if (hands[kind] > 0) {
        moves.push(...this.getLegalDropsByKind(shogi, color, kind));
      }
    }

    return moves;
  }

  /**
   * 特定の手が合法かどうかをチェック
   * JKFEditorで手を適用する前の検証用
   */
  static isLegalMove(shogi: Shogi, move: IMove): boolean {
    try {
      if (move.from) {
        // 移動手の場合
        const legalMoves = this.getLegalMovesFrom(
          shogi,
          move.from.x,
          move.from.y,
        );
        return legalMoves.some(
          (legal) => legal.to.x === move.to.x && legal.to.y === move.to.y,
        );
      } else {
        // 打ち手の場合
        const legalDrops = this.getLegalDropsByKind(
          shogi,
          move.color!,
          move.kind!,
        );
        return legalDrops.some(
          (legal) => legal.to.x === move.to.x && legal.to.y === move.to.y,
        );
      }
    } catch {
      return false;
    }
  }
  static canPromote(shogi: Shogi, move: IMove): boolean {
    if (!move.from) return false; // 打ち手は成れない

    const piece = shogi.get(move.from.x, move.from.y);
    if (!piece) return false;

    // 既に成駒なら成れない
    const promotableKinds: Kind[] = ["FU", "KY", "KE", "GI", "KA", "HI"];
    if (!promotableKinds.includes(piece.kind)) return false;

    // 敵陣に入るかチェック
    const isBlack = piece.color === Color.Black;
    const enemyZone = isBlack ? [1, 2, 3] : [7, 8, 9];

    return enemyZone.includes(move.from.y) || enemyZone.includes(move.to.y);
  }

  /**
   * 指定の手で成らなければならないかチェック（強制成り）
   */
  static mustPromote(shogi: Shogi, move: IMove): boolean {
    if (!move.from) return false; // 打ち手は成れない

    const piece = shogi.get(move.from.x, move.from.y);
    if (!piece) return false;

    const isBlack = piece.color === Color.Black;

    // 歩・香・桂の強制成り判定
    if (piece.kind === "FU" || piece.kind === "KY") {
      // 一段目に入ったら強制成り
      const forcePromoteRow = isBlack ? 1 : 9;
      return move.to.y === forcePromoteRow;
    }

    if (piece.kind === "KE") {
      // 一・二段目に入ったら強制成り
      const forcePromoteRows = isBlack ? [1, 2] : [8, 9];
      return forcePromoteRows.includes(move.to.y);
    }

    return false;
  }

  /**
   * 成り・不成の選択肢を含む合法手を取得
   * UI用：ユーザーに成り・不成を選択させる必要がある手を識別
   */
  static getLegalMovesWithPromotionOptions(
    shogi: Shogi,
    x: number,
    y: number,
  ): Array<{
    move: IMove;
    canPromote: boolean;
    mustPromote: boolean;
  }> {
    const basicMoves = this.getLegalMovesFrom(shogi, x, y);

    return basicMoves.map((move) => ({
      move,
      canPromote: this.canPromote(shogi, move),
      mustPromote: this.mustPromote(shogi, move),
    }));
  }
}
