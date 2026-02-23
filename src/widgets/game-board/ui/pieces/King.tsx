import type { PieceProps } from ".";
import {
  PIECE_IMAGES,
  PLAYER_COLORS,
} from "../../../../entities/position/model/shogi";
import "../Piece.scss";

function King({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].KING;

  return (
    <div
      className={`piece piece__king ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="king"
      data-color={color}
    >
      <img
        src={imagePath}
        alt={color === PLAYER_COLORS.SENTE ? "王" : "玉"}
        className="piece-image"
        draggable={false}
      />
    </div>
  );
}

export default King;
