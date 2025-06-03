import type { Color, JKFState } from "@/types";

export interface GameStateReader {
  getCurrentState(): JKFState | null;
  getCurrentMoveIndex(): number;
  getTotalMoves(): number;
  getCurrentTurn(): Color | null;

  isGameLoaded(): boolean;
  isAtStart(): boolean;
  isAtEnd(): boolean;
}
