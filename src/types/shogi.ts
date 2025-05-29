import type { PlayerColor } from "../constants/shogi";

export interface PieceProps {
  color: PlayerColor;
  onClick?: () => void;
}
