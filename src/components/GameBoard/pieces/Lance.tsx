import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import type { PieceProps } from "@/types/shogi";
import "../Piece.scss";

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
