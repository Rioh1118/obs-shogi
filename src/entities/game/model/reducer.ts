import type { GameAction, GameContextState } from "./types";
import { initialGameState } from "./types";

export function gameReducer(
  state: GameContextState,
  action: GameAction,
): GameContextState {
  switch (action.type) {
    case "set_jkf_player":
      return { ...state, jkfPlayer: action.payload, error: null };

    case "update_jkf_player":
      return { ...state };

    case "set_selection":
      return {
        ...state,
        selectedPosition: action.payload.selectedPosition,
        legalMoves: action.payload.legalMoves,
      };

    case "clear_selection":
      return { ...state, selectedPosition: null, legalMoves: [] };

    case "set_last_move":
      return { ...state, lastMove: action.payload };

    case "set_mode":
      return { ...state, mode: action.payload };

    case "set_cursor":
      return { ...state, cursor: action.payload };

    case "set_loading":
      return { ...state, isLoading: action.payload };

    case "set_error":
      return { ...state, error: action.payload, isLoading: false };

    case "clear_error":
      return { ...state, error: null };

    case "reset_state":
      return { ...initialGameState };

    case "partial_update":
      return { ...state, ...action.payload };

    default:
      return state;
  }
}
