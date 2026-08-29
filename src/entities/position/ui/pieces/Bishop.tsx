import type { PieceProps } from ".";
import { PLAYER_COLORS } from "@/entities/position/model/shogi";
import "../Piece.scss";
import { PIECE_IMAGES } from "@/entities/position/model/pieceImages";

function Bishop({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].BISHOP;

  return (
    <div
      className={`piece piece__bishop ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="bishop"
      data-color={color}
    >
      <img src={imagePath} alt="角" className="piece-image" draggable={false} />
    </div>
  );
}

export default Bishop;
