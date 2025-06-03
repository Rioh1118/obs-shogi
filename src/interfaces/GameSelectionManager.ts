import type { ShogiMove, Color, Kind } from "@/types";
import type { SelectedPosition } from "@/types/state";

export interface GameSelectionManager {
  // 選択操作
  selectSquare(position: { x: number; y: number }): void;
  selectHand(color: Color, kind: Kind): void;
  clearSelection(): void;

  getSelectedPosition(): SelectedPosition | null;
  updaateLegalMoves(moves: ShogiMove[]): void;
}
