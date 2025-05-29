import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import type { PieceProps } from "@/types/shogi";
import "../Piece.scss";

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
