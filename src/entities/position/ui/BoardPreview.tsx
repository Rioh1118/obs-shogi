import type { Piece } from "shogi.js";
import { indexToCoords } from "@/entities/position/lib/boardCoords";
import { BOARD_SIZE } from "@/entities/position/model/board";
import PieceImage from "./PieceImage";
import "./BoardPreview.scss";

type Props = {
  pieces: (Piece | null)[][];
};

/** 押せない盤。幅はコンテナいっぱいで、高さは盤の比で決まる */
function BoardPreview({ pieces }: Props) {
  return (
    <div className="board-preview">
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
  );
}

export default BoardPreview;
