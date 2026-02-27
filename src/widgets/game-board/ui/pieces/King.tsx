import type { PieceProps } from ".";
import { PLAYER_COLORS } from "@/entities/position/model/shogi";
import "../Piece.scss";
import { PIECE_IMAGES } from "@/entities/position/model/pieceImages";

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
