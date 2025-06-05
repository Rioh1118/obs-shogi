import type { Color } from "@/types";
import type { GameState } from "@/types/state";

export interface GameStateReader {
  getCurrentState(): GameState;
  getCurrentMoveIndex(): number;
  getTotalMoves(): number;
  getCurrentTurn(): Color | null;

  isGameLoaded(): boolean;
  isAtStart(): boolean;
  isAtEnd(): boolean;
}
