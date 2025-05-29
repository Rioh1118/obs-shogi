import Square from "./Square";
import { useGame } from "../../../contexts/GameContext";
import { indexToCoords } from "../../../utils/boardUtils";
import { BOARD_SIZE } from "../../../constants/shogi";
import "./Board.scss";
import PieceFactory from "../PieceFactory";
import { Piece } from "shogi.js";

function Board() {
  const { getCurrentBoard, selectSquare, legalMoves, lastMove } = useGame();

  const board = getCurrentBoard();

  if (!board) {
    return <div className="board-loading">盤面を読み込み中...</div>;
  }

  const isSquareHighlighted = (x: number, y: number) => {
    return legalMoves.some((move) => move.to.x === x && move.to.y === y);
  };

  const isLastMove = (x: number, y: number) => {
    if (!lastMove) return false;
    return (
      (lastMove.to.x === x && lastMove.to.y === y) ||
      (lastMove.from?.x === x && lastMove.from?.y === y)
    );
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
          onClick={() => selectSquare(x, y)}
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
