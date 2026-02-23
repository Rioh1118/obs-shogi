import type { PieceProps } from ".";
import {
  PIECE_IMAGES,
  PLAYER_COLORS,
} from "../../../../entities/position/model/shogi";
import "../Piece.scss";

function PromKnight({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].PROM_KNIGHT;

  return (
    <div
      className={`piece piece__prom-knight ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="prom-knight"
      data-color={color}
    >
      <img
        src={imagePath}
        alt="成桂"
        className="piece-image"
        draggable={false}
      />
    </div>
  );
}

export default PromKnight;
