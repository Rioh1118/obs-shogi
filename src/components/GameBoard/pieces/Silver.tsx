import type { PieceProps } from ".";
import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import "../Piece.scss";

function Silver({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].SILVER;

  return (
    <div
      className={`piece piece__silver ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      date-piece="silver"
      data-color={color}
    >
      <img src={imagePath} alt="銀" className="piece-image" draggable={false} />
    </div>
  );
}

export default Silver;
