import { Shogi, type IMove, Color } from "shogi.js";
import type { JKFFormat } from "../types/kifu";
import { PieceUtils } from "../utils/pieceUtils";
import KifuWriter from "../commands/kifuWriter";
import type { SelectedPosition } from "../types/game";

export class MoveService {
  // JKFに新しい手を追加
  static addMoveToJKF(
    jkf: JKFFormat,
    move: IMove,
    currentTurn: Color | null,
  ): JKFFormat {
    const newJkf = JSON.parse(JSON.stringify(jkf)); // ディープコピー

    if (!newJkf.moves) {
      newJkf.moves = [{}]; // moves[0]は初期局面用
    }

    const isPromotion = move.kind
      ? PieceUtils.isPromotedPiece(move.kind)
      : false;
    const jkfPieceKind =
      isPromotion && move.kind
        ? PieceUtils.getOriginalKind(move.kind)
        : move.kind;
    const moveColor = move.color || currentTurn;

    const jkfMove = {
      move: {
        from: move.from ? { x: move.from.x, y: move.from.y } : undefined,
        to: { x: move.to.x, y: move.to.y },
        piece: jkfPieceKind,
        color: moveColor,
        promote: isPromotion,
      },
    };

    newJkf.moves.push(jkfMove);
    return newJkf;
  }

  // 指し手を実行
  static async executeMoveOnShogi(
    shogi: Shogi,
    selectedPosition: SelectedPosition,
    targetMove: IMove,
    targetSquare: { x: number; y: number },
  ): Promise<void> {
    if (selectedPosition.type === "square") {
      const isPromotion = targetMove.kind
        ? PieceUtils.isPromotedPiece(targetMove.kind)
        : false;

      shogi.move(
        selectedPosition.x,
        selectedPosition.y,
        targetSquare.x,
        targetSquare.y,
        isPromotion,
      );

      console.log("駒移動:", {
        from: `(${selectedPosition.x},${selectedPosition.y})`,
        to: `(${targetSquare.x},${targetSquare.y})`,
        promote: isPromotion,
        kind: targetMove.kind,
      });
    } else if (selectedPosition.type === "hand") {
      if (!targetMove.kind) {
        throw new Error("駒打ちで駒種が指定されていません");
      }

      shogi.drop(
        targetSquare.x,
        targetSquare.y,
        targetMove.kind,
        selectedPosition.color,
      );

      console.log("駒打ち:", {
        to: `(${targetSquare.x},${targetSquare.y})`,
        kind: targetMove.kind,
        color: selectedPosition.color,
      });
    }
  }

  // ファイル保存
  static async saveToFile(jkf: JKFFormat, filePath: string): Promise<void> {
    try {
      const format = KifuWriter.getFormatFromPath(filePath);
      await KifuWriter.writeToFile(jkf, filePath, format);
      console.log("棋譜ファイルを更新しました:", filePath);
    } catch (error) {
      console.error("ファイル保存に失敗:", error);
      throw error;
    }
  }
}
