import Square from "./Square";
import { indexToCoords } from "@/entities/position/lib/boardCoords";
import { BOARD_SIZE } from "@/entities/position/model/board";
import "./Board.scss";
import PieceImage from "@/entities/position/ui/PieceImage";
import { Color } from "shogi.js";
import { useEffect, useState } from "react";
import PromotionDialog from "./PromotionDialog";
import { canPromote, mustPromote, useGame, type ShogiMove } from "@/entities/game";

/**
 * 9×9の升。押下を選択と着手へ渡す。
 *
 * 成れる手では移動先の升に成りの選択肢を出し、答えを待ってから指す。
 */
function Board() {
  const { state, view, selectSquare, clearSelection } = useGame();

  const shogi = view.player?.shogi;
  const selectedPosition = state.selectedPosition;
  const legalMoves = view.legalMoves;
  const lastMove = view.lastMove;

  const [promotionState, setPromotionState] = useState<{
    x: number;
    y: number;
    jkfKind: string;
    color: Color;
    moveCount: number;
    resolve: (promote: boolean) => void;
  } | null>(null);

  // 待っている間に別の操作で局面が動いたら、選択肢と選択を畳む。見るのは手数だけ
  useEffect(() => {
    if (promotionState && shogi) {
      const currentMoveCount = view.player?.tesuu || 0;

      if (currentMoveCount !== promotionState.moveCount) {
        console.log("局面が変化したため成り選択をキャンセル");
        setPromotionState(null);
        clearSelection();
      }
    }
  }, [promotionState, view.player?.tesuu, shogi, clearSelection]);

  // 選択位置の変化を監視
  useEffect(() => {
    if (promotionState) {
      return;
    }
  }, [promotionState, selectedPosition]);

  if (!shogi) {
    return <div className="board-loading">盤面を読み込み中…</div>;
  }

  const isSquareHighlighted = (x: number, y: number) => {
    return legalMoves.some((move) => move.to.x === x && move.to.y === y);
  };

  const isLastMove = (x: number, y: number) => {
    if (!lastMove) return false;
    return lastMove.to.x === x && lastMove.to.y === y;
  };

  const isSelectedSquare = (x: number, y: number) =>
    selectedPosition?.type === "square" && selectedPosition.x === x && selectedPosition.y === y;

  const handleSquareClick = async (x: number, y: number) => {
    if (!view.player) return;

    if (promotionState) {
      return;
    }

    if (selectedPosition?.type === "square") {
      if (selectedPosition.x === x && selectedPosition.y === y) {
        clearSelection();
        return;
      }

      const targetMove = legalMoves.find((move) => move.to.x === x && move.to.y === y);

      if (targetMove) {
        const fromPiece = shogi.get(selectedPosition.x, selectedPosition.y);
        if (!fromPiece) return;

        const shogiMove: ShogiMove = {
          from: { x: selectedPosition.x, y: selectedPosition.y },
          to: { x, y },
          kind: fromPiece.kind,
          color: fromPiece.color,
        };

        let promote: boolean | undefined = undefined;

        if (mustPromote(shogi, shogiMove)) {
          promote = true;
        } else if (canPromote(shogi, shogiMove)) {
          promote = await new Promise((resolve) => {
            setPromotionState({
              x,
              y,
              jkfKind: fromPiece.kind,
              color: fromPiece.color,
              moveCount: view.player?.tesuu || 0,
              resolve,
            });
          });
        }

        selectSquare(x, y, promote);
        return;
      }
    }
    selectSquare(x, y);
  };

  const squares = Array.from({ length: BOARD_SIZE.TOTAL_SQUARES }, (_, index) => {
    const { x, y } = indexToCoords(index);
    const piece = shogi.get(x, y);
    const isPromotionSquare =
      promotionState !== null && promotionState.x === x && promotionState.y === y;

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
          <PieceImage
            kind={piece.kind}
            color={piece.color}
            onClick={() => console.log(`Piece clicked: ${piece.kind} at ${x}${y}`)}
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
  });

  return (
    <div className="board-container">
      <div className="position">
        <div className="position__grid">{squares}</div>
      </div>
    </div>
  );
}

export default Board;
