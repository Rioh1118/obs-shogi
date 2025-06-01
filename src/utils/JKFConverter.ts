import type { IMove } from "shogi.js";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

export class JKFConverter {
  /**
   * IMoveMoveFormat を IMove に変換
   */
  static toIMove(jkfMove: IMoveMoveFormat): IMove {
    // toが必須なのでundefinedチェック
    if (!jkfMove.to) {
      throw new Error("JKF move must have 'to' field");
    }

    return {
      from: jkfMove.from
        ? {
            x: jkfMove.from.x,
            y: jkfMove.from.y,
          }
        : undefined,
      to: {
        x: jkfMove.to.x,
        y: jkfMove.to.y,
      },
      kind: jkfMove.piece, // piece -> kind
      color: jkfMove.color,
    };
  }

  /**
   * IMove を IMoveMoveFormat に変換
   */
  static toJKFMove(move: IMove): IMoveMoveFormat {
    // colorが必須なのでundefinedチェック
    if (!move.color) {
      throw new Error("IMove must have 'color' field for JKF conversion");
    }

    // kindが必須なのでundefinedチェック
    if (!move.kind) {
      throw new Error("IMove must have 'kind' field for JKF conversion");
    }

    return {
      from: move.from
        ? {
            x: move.from.x,
            y: move.from.y,
          }
        : undefined,
      to: {
        x: move.to.x,
        y: move.to.y,
      },
      piece: move.kind, // kind -> piece
      color: move.color,
      // JKF特有のフィールドはデフォルト値またはundefined
      same: undefined,
      promote: undefined,
      capture: undefined,
      relative: undefined,
    };
  }

  /**
   * IMove配列をIMoveMoveFormat配列に変換
   */
  static toJKFMoves(moves: IMove[]): IMoveMoveFormat[] {
    return moves.map((move) => this.toJKFMove(move));
  }

  /**
   * IMoveMoveFormat配列をIMove配列に変換
   */
  static toIMoves(jkfMoves: IMoveMoveFormat[]): IMove[] {
    return jkfMoves.map((jkfMove) => this.toIMove(jkfMove));
  }

  /**
   * JKF形式の手からプレビュー用の簡易情報を取得
   */
  static getPreviewInfo(jkfMove: IMoveMoveFormat): {
    piece: string;
    to: string;
    from?: string;
    promote?: boolean;
    capture?: boolean;
  } {
    if (!jkfMove.to) {
      throw new Error("JKF move must have 'to' field");
    }

    return {
      piece: jkfMove.piece,
      to: `${jkfMove.to.x}${jkfMove.to.y}`,
      from: jkfMove.from ? `${jkfMove.from.x}${jkfMove.from.y}` : undefined,
      promote: jkfMove.promote,
      capture: !!jkfMove.capture,
    };
  }
}
