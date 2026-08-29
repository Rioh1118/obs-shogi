import type { PieceProps } from ".";
import { PLAYER_COLORS } from "@/entities/position/model/shogi";
import "../Piece.scss";
import { PIECE_IMAGES } from "@/entities/position/model/pieceImages";

function Gold({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].GOLD;

  return (
    <div
      className={`piece piece__gold ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      date-piece="gold"
      data-color={color}
    >
      <img src={imagePath} alt="金" className="piece-image" draggable={false} />
    </div>
  );
}

export default Gold;
