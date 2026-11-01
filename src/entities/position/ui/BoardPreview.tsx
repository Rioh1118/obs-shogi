import type { CSSProperties } from "react";
import type { Piece } from "shogi.js";
import { indexToCoords } from "@/entities/position/lib/boardCoords";
import { BOARD_SIZE } from "@/entities/position/model/board";
import PieceImage from "./PieceImage";
import "./BoardPreview.scss";

type Props = {
  pieces: (Piece | null)[][];
  /** 盤の一辺（px） */
  size: number;
};

function BoardPreview({ pieces, size }: Props) {
  const squareSize = size / 9;
  const boardStyle = {
    "--board-size": `${size}px`,
    "--square-size": `${squareSize}px`,
    "--piece-size": `${squareSize * 0.8}px`,
  } as CSSProperties;

  return (
    <div className="board-preview" style={boardStyle}>
      <div className="board-preview__container">
        <div className="board-preview__grid">
          {Array.from({ length: BOARD_SIZE.TOTAL_SQUARES }).map((_, index) => {
            const { x, y } = indexToCoords(index);
            const piece = pieces[x - 1]?.[y - 1];

            return (
              <div key={index} className="board-preview__square">
                {piece && (
                  <div className="board-preview__piece">
                    <PieceImage kind={piece.kind} color={piece.color} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default BoardPreview;
