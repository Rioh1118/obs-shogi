import type { GameMode, GameState } from "@/types/state";

export interface GameModeManager {
  // モード操作
  setMode(mode: GameMode): GameState;
  getCurrentMode(): GameMode;

  // エラー管理
  clearError(): GameState;
  getError(): string | null;
}
