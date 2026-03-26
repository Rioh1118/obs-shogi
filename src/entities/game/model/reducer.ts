import type { GameAction, GameContextState } from "./types";
import { initialGameState } from "./types";

export function gameReducer(state: GameContextState, action: GameAction): GameContextState {
  switch (action.type) {
    case "game_loaded":
      return {
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: [...action.payload.cursor.forkPointers],
        selectedPosition: null,
        loadedAbsPath: action.payload.absPath,
        isLoading: false,
        error: null,
      };

    case "navigated":
      return {
        ...state,
        cursor: action.payload.cursor,
        branchPlan: action.payload.branchPlan,
        selectedPosition: null,
        error: null,
      };

    case "jkf_replaced":
      return {
        ...state,
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: action.payload.branchPlan,
        selectedPosition: null,
        isLoading: false,
        error: null,
      };

    case "set_selection":
      return {
        ...state,
        selectedPosition: action.payload,
      };

    case "clear_selection":
      return {
        ...state,
        selectedPosition: null,
      };

    case "set_loading":
      return {
        ...state,
        isLoading: action.payload,
      };

    case "set_error":
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };

    case "clear_error":
      return {
        ...state,
        error: null,
      };

    case "reset_state":
      return initialGameState;

    default:
      return state;
  }
}
