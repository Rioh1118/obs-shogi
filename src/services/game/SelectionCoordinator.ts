import type { GameSelectionManager } from "@/interfaces";
import type { GameStateManager } from "./GameStateManager";
import type { ShogiMove, Color, Kind } from "@/types";
import type { SelectedPosition } from "@/types/state";

export class SelectionCoordinator implements GameSelectionManager {
  private stateManager: GameStateManager;

  constructor(stateManager: GameStateManager) {
    this.stateManager = stateManager;
  }

  selectSquare(position: { x: number; y: number }): void {
    const selectedPosition: SelectedPosition = {
      type: "square",
      ...position,
    };
    this.stateManager.setSelectedPosition(selectedPosition);
  }

  selectHand(color: Color, kind: Kind): void {
    const selectedPosition: SelectedPosition = {
      type: "hand",
      color,
      kind,
    };
    this.stateManager.setSelectedPosition(selectedPosition);
  }

  clearSelection(): void {
    this.stateManager.setSelectedPosition(null);
  }

  getSelectedPosition(): SelectedPosition | null {
    const currentState = this.stateManager.getCurrentState();
    return currentState.selectedPosition;
  }

  updateLegalMoves(moves: ShogiMove[]): void {
    this.stateManager.setLegalMoves(moves);
  }
}
