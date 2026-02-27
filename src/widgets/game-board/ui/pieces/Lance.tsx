import type { PieceProps } from ".";
import { PLAYER_COLORS } from "@/entities/position/model/shogi";
import "../Piece.scss";
import { PIECE_IMAGES } from "@/entities/position/model/pieceImages";

function Lance({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].LANCE;

  return (
    <div
      className={`piece piece__lance ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      date-piece="lance"
      data-color={color}
    >
      <img src={imagePath} alt="香" className="piece-image" draggable={false} />
    </div>
  );
}

export default Lance;
