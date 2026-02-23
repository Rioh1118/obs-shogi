import type { PieceProps } from ".";
import {
  PIECE_IMAGES,
  PLAYER_COLORS,
} from "../../../../entities/position/model/shogi";
import "../Piece.scss";

function PromPawn({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].PROM_PAWN;

  return (
    <div
      className={`piece piece__prom-pawn ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="prom-pawn"
      data-color={color}
    >
      <img src={imagePath} alt="と" className="piece-image" draggable={false} />
    </div>
  );
}

export default PromPawn;
