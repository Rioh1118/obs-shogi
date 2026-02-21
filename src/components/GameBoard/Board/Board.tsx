import Square from "./Square";
import { useGame } from "@/contexts/GameContext";
import { indexToCoords } from "@/utils/boardUtils";
import { BOARD_SIZE } from "@/constants/shogi";
import "./Board.scss";
import PieceFactory from "../PieceFactory";
import { Piece } from "shogi.js";
import type { Color, ShogiMove } from "@/types";
import { useEffect, useState } from "react";
import PromotionDialog from "./PromotionDialog";

function Board() {
  const { state, helpers, selectSquare, clearSelection } = useGame();

  const shogi = state.jkfPlayer?.shogi;
  const selectedPosition = state.selectedPosition;
  const legalMoves = state.legalMoves;
  const lastMove = state.lastMove;

  const [promotionState, setPromotionState] = useState<{
    x: number;
    y: number;
    jkfKind: string;
    color: Color;
    moveCount: number;
    resolve: (promote: boolean) => void;
  } | null>(null);

  // 局面変化を監視してダイアログを自動で閉じる
  useEffect(() => {
    if (promotionState && shogi) {
      const currentMoveCount = state.jkfPlayer?.tesuu || 0;

      // 手数が変わった = 他の操作で局面が変化した
      if (currentMoveCount !== promotionState.moveCount) {
        console.log("局面が変化したため成り選択をキャンセル");
        setPromotionState(null);
        clearSelection();
      }
    }
  }, [promotionState, state.jkfPlayer?.tesuu, shogi, clearSelection]);

  // 選択位置の変化を監視
  useEffect(() => {
    if (promotionState) {
      return;
    }
  }, [promotionState, selectedPosition]);

  if (!shogi) {
    return <div className="board-loading">盤面を読み込み中...</div>;
  }

  const isSquareHighlighted = (x: number, y: number) => {
    return legalMoves.some((move) => move.to.x === x && move.to.y === y);
  };

  const isLastMove = (x: number, y: number) => {
    if (!lastMove) return false;
    return lastMove.to.x === x && lastMove.to.y === y;
  };

  const isSelectedSquare = (x: number, y: number) =>
    selectedPosition?.type === "square" &&
    selectedPosition.x === x &&
    selectedPosition.y === y;

  const handleSquareClick = async (x: number, y: number) => {
    if (!state.jkfPlayer) return;

    if (promotionState) {
      return;
    }

    // 駒が選択されていて、別のマスがクリックされた場合の移動処理
    if (selectedPosition?.type === "square") {
      // 同じマスをクリックした場合は選択解除
      if (selectedPosition.x === x && selectedPosition.y === y) {
        clearSelection();
        return;
      }

      // 合法手かどうかチェック
      const targetMove = legalMoves.find(
        (move) => move.to.x === x && move.to.y === y,
      );

      if (targetMove) {
        // 移動元の駒情報を取得
        const fromPiece = shogi.get(selectedPosition.x, selectedPosition.y);
        if (!fromPiece) return;

        // ShogiMove形式に変換
        const shogiMove: ShogiMove = {
          from: { x: selectedPosition.x, y: selectedPosition.y },
          to: { x, y },
          kind: fromPiece.kind,
          color: fromPiece.color,
        };

        // 成り判定
        const canPromote = helpers.canPromoteMove(state.jkfPlayer, shogiMove);
        const mustPromote = helpers.mustPromoteMove(state.jkfPlayer, shogiMove);

        let promote = false;

        if (mustPromote) {
          // 強制成り
          promote = true;
        } else if (canPromote) {
          promote = await new Promise((resolve) => {
            setPromotionState({
              x,
              y,
              jkfKind: fromPiece.kind,
              color: fromPiece.color,
              moveCount: state.jkfPlayer?.tesuu || 0,
              resolve,
            });
          });
        }

        // selectSquareを成りフラグ付きで呼び出し
        selectSquare(x, y, promote);
        return;
      }
    }
    selectSquare(x, y);
  };

  const squares = Array.from(
    { length: BOARD_SIZE.TOTAL_SQUARES },
    (_, index) => {
      const { x, y } = indexToCoords(index);
      const piece = shogi.get(x, y);
      const isPromotionSquare =
        promotionState !== null &&
        promotionState.x === x &&
        promotionState.y === y;

      return (
        <Square
          key={index}
          x={x}
          y={y}
          index={index}
          isSelected={isSelectedSquare(x, y)}
          isHighlighted={isSquareHighlighted(x, y)}
          isLastMove={isLastMove(x, y)}
          onClick={() => handleSquareClick(x, y)}
        >
          {piece && (
            <PieceFactory
              jkfKind={piece.kind}
              color={piece.color}
              isPromoted={Piece.isPromoted(piece.kind)}
              onClick={() =>
                console.log(`Piece clicked: ${piece.kind} at ${x}${y}`)
              }
            />
          )}
          {isPromotionSquare && (
            <PromotionDialog
              jkfKind={promotionState.jkfKind}
              color={promotionState.color}
              setPromote={(promote) => {
                promotionState.resolve(promote);
                setTimeout(() => setPromotionState(null), 0);
              }}
            />
          )}
        </Square>
      );
    },
  );

  return (
    <div className="board-container">
      <div className="position">
        <div className="position__grid">{squares}</div>
      </div>
    </div>
  );
}

export default Board;
