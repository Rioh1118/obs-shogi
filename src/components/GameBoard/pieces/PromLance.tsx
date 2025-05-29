import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import type { PieceProps } from "@/types/shogi";
import "../Piece.scss";

function PromLance({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].PROM_LANCE;

  return (
    <div
      className={`piece piece__prom-lance ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="prom-lance"
      data-color={color}
    >
      <img
        src={imagePath}
        alt="成香"
        className="piece-image"
        draggable={false}
      />
    </div>
  );
}

export default PromLance;
