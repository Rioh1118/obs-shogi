import type { GameModeManager } from "@/interfaces";
import { GameStateManager } from "./GameStateManager";
import type { GameMode, GameState } from "@/types/state";

export class GameModeController implements GameModeManager {
  private stateManager: GameStateManager;

  constructor(stateManager: GameStateManager) {
    this.stateManager = stateManager;
  }

  setMode(mode: GameMode): GameState {
    this.stateManager.setMode(mode);
    return this.stateManager.getCurrentState();
  }

  getCurrentMode(): GameMode {
    const currentState = this.stateManager.getCurrentState();
    return currentState.mode;
  }

  clearError(): GameState {
    this.stateManager.setError(null);
    return this.stateManager.getCurrentState();
  }

  getError(): string | null {
    const currentState = this.stateManager.getCurrentState();
    return currentState.error;
  }
}
