import type { PieceProps } from ".";
import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import "../Piece.scss";

function Knight({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].KNIGHT;

  return (
    <div
      className={`piece piece__knight ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      date-piece="knight"
      data-color={color}
    >
      <img
        src={imagePath}
        alt="桂馬"
        className="piece-image"
        draggable={false}
      />
    </div>
  );
}

export default Knight;
