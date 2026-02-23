import type { PieceProps } from ".";
import {
  PIECE_IMAGES,
  PLAYER_COLORS,
} from "../../../../entities/position/model/shogi";
import "../Piece.scss";

function Rook({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].ROOK;

  return (
    <div
      className={`piece piece__rook ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="rook"
      data-color={color}
    >
      <img src={imagePath} alt="飛" className="piece-image" draggable={false} />
    </div>
  );
}

export default Rook;
