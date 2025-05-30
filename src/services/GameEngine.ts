import { Shogi, type Kind, type IMove } from "shogi.js";
import type { JKFFormat } from "@/types/kifu";

export class GameEngine {
  // 初期化
  static initializeFromJKF(jkf: JKFFormat): Shogi {
    const shogi = new Shogi();
    if (jkf.initial?.preset === "HIRATE" || !jkf.initial?.data) {
      shogi.initialize();
    } else {
      shogi.initialize();
      // TODO: カスタム局面の実装
    }
    return shogi;
  }

  // 駒種変換
  static convertToShogiKind(jkfPiece: string): Kind {
    const validKinds: Kind[] = [
      "FU",
      "KY",
      "KE",
      "GI",
      "KI",
      "KA",
      "HI",
      "OU",
      "TO",
      "NY",
      "NK",
      "NG",
      "UM",
      "RY",
    ];
    if (validKinds.includes(jkfPiece as Kind)) {
      return jkfPiece as Kind;
    }
    throw new Error(`不正な駒種類: ${jkfPiece}`);
  }

  // 実際の手数計算
  static getActualMoveCount(jkf: JKFFormat): number {
    if (!jkf.moves || jkf.moves.length <= 1) return 0;
    let count = 0;
    for (let i = 1; i < jkf.moves.length; i++) {
      const moveData = jkf.moves[i];
      if (moveData.move) {
        count++;
      } else if (moveData.special) {
        break;
      }
    }
    return count;
  }

  // 指定手数まで進める
  static applyShogiMovesToIndex(
    jkf: JKFFormat,
    targetIndex: number,
  ): { shogi: Shogi; lastMove: IMove | null } {
    const newShogi = this.initializeFromJKF(jkf);
    let lastMove: IMove | null = null;

    for (let i = 1; i <= targetIndex && i < jkf.moves.length; i++) {
      const moveData = jkf.moves[i];
      if (moveData.move) {
        const { from, to, piece, promote, color } = moveData.move;
        try {
          const shogiKind = this.convertToShogiKind(piece);
          if (from) {
            newShogi.move(from.x, from.y, to!.x, to!.y, promote || false);
          } else {
            newShogi.drop(to!.x, to!.y, shogiKind, color);
          }
          lastMove = {
            from: from ? { x: from.x, y: from.y } : undefined,
            to: { x: to!.x, y: to!.y },
            kind: shogiKind,
            color,
          };
        } catch (err) {
          console.error(`手の適用に失敗: ${i}手目`, err);
          throw err;
        }
      } else if (moveData.special) {
        console.log(`特殊手を検出: ${moveData.special} at move ${i}`);
        break;
      }
    }
    return { shogi: newShogi, lastMove };
  }
}
