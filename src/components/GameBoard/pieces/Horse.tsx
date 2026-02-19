import type { PieceProps } from ".";
import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import "../Piece.scss";

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
