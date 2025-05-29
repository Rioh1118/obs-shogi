import { PIECE_IMAGES, PLAYER_COLORS } from "../../../constants/shogi";
import type { PieceProps } from "@/types/shogi";
import "../Piece.scss";

function PromSilver({ color, onClick }: PieceProps) {
  const imagePath = PIECE_IMAGES[color].PROM_SILVER;

  return (
    <div
      className={`piece piece__prom-silver ${color === PLAYER_COLORS.SENTE ? "sente" : "gote"}`}
      onClick={onClick}
      data-piece="prom-silver"
      data-color={color}
    >
      <img
        src={imagePath}
        alt="成銀"
        className="piece-image"
        draggable={false}
      />
    </div>
  );
}

export default PromSilver;
