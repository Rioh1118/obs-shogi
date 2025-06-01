import Square from "./Square";
import { useGame } from "../../../contexts/GameContext";
import { indexToCoords } from "../../../utils/boardUtils";
import { BOARD_SIZE } from "../../../constants/shogi";
import "./Board.scss";
import PieceFactory from "../PieceFactory";
import { Piece } from "shogi.js";

function Board() {
  const { state, operations, getCurrentTurn, getLegalMoves } = useGame();

  const board = state.shogiGame?.board;
  const currentTurn = getCurrentTurn();
  const selectedPosition = state.selectedPosition;
  const legalMoves = getLegalMoves();
  const lastMove = state.lastMove;

  if (!board) {
    return <div className="board-loading">盤面を読み込み中...</div>;
  }

  const isSquareHighlighted = (x: number, y: number) => {
    return legalMoves.some((move) => move.to.x === x && move.to.y === y);
  };

  const isLastMove = (x: number, y: number) => {
    if (!lastMove) return false;
    return lastMove.to.x === x && lastMove.to.y === y;
  };

  const handleSquareClick = async (x: number, y: number, piece: Piece) => {
    if (selectedPosition?.type === "hand") {
      const isLegalDrop = legalMoves.some(
        (move) => move.to.x === x && move.to.y === y,
      );
      if (isLegalDrop) {
        const dropMove = legalMoves.find(
          (move) => move.to.x === x && move.to.y === y,
        );
        if (dropMove) {
          operations.makeMove(dropMove);
        }
        operations.clearSelection();
      } else {
        operations.clearSelection();
      }
      return;
    }

    if (selectedPosition?.type === "square") {
      // 同じマスをクリックした場合選択解除
      if (selectedPosition.x === x && selectedPosition.y === y) {
        operations.clearSelection();
        return;
      }

      const isLegalMove = legalMoves.some(
        (move) => move.to.x === x && move.to.y === y,
      );

      if (isLegalMove) {
        const move = legalMoves.find(
          (move) => move.to.x === x && move.to.y === y,
        );
        if (move) {
          operations.makeMove(move);
        }
        operations.clearSelection();
      } else {
        if (piece && piece.color === currentTurn) {
          operations.selectSquare({ x, y });
        } else {
          operations.clearSelection();
        }
      }
      return;
    }
    // 駒がある場合
    if (piece && piece.color === currentTurn) {
      operations.selectSquare({ x, y });
    } else {
      // 空のマスをクリックした場合は選択解除
      operations.clearSelection();
    }
  };

  const squares = Array.from(
    { length: BOARD_SIZE.TOTAL_SQUARES },
    (_, index) => {
      const { x, y } = indexToCoords(index);

      const piece = board[x - 1]?.[y - 1];

      return (
        <Square
          key={index}
          x={x}
          y={y}
          index={index}
          isHighlighted={isSquareHighlighted(x, y)}
          isLastMove={isLastMove(x, y)}
          onClick={() => handleSquareClick(x, y, piece)}
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
