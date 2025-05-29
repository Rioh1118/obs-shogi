import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import type { PieceProps } from "@/types/shogi";
import "../Piece.scss";

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
