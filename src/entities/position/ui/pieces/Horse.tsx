import type { PieceProps } from ".";
import { PLAYER_COLORS } from "@/entities/position/model/shogi";
import "../Piece.scss";
import { PIECE_IMAGES } from "@/entities/position/model/pieceImages";

function Horse({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].HORSE;

  return (
    <div
      className={`piece piece__horse ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="horse"
      data-color={color}
    >
      <img src={imagePath} alt="馬" className="piece-image" draggable={false} />
    </div>
  );
}

export default Horse;
