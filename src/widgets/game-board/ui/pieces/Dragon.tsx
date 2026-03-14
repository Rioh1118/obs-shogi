import type { PieceProps } from ".";
import { PLAYER_COLORS } from "@/entities/position/model/shogi";
import "../Piece.scss";
import { PIECE_IMAGES } from "@/entities/position/model/pieceImages";

function Dragon({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].DRAGON;

  return (
    <div
      className={`piece piece__dragon ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="dragon"
      data-color={color}
    >
      <img src={imagePath} alt="龍" className="piece-image" draggable={false} />
    </div>
  );
}

export default Dragon;
