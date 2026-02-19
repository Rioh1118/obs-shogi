import type { PieceProps } from ".";
import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import "../Piece.scss";

function Pawn({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].PAWN;

  return (
    <div
      className={`piece piece__pawn ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      date-piece="pawn"
      data-color={color}
    >
      <img src={imagePath} alt="歩" className="piece-image" draggable={false} />
    </div>
  );
}

export default Pawn;
