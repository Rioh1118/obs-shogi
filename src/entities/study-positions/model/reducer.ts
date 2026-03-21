import type { StudyPosition } from "./types";

export type StudyPositionsState = {
  positions: StudyPosition[];
  selectedId: string | null;

  isLoading: boolean;
  isLoaded: boolean;
  isSaving: boolean;

  error: string | null;
};

export type Action =
  | { type: "load_start" }
  | { type: "load_success"; payload: { positions: StudyPosition[] } }
  | { type: "load_error"; payload: { message: string } }
  | { type: "save_start" }
  | { type: "save_success" }
  | { type: "save_error"; payload: { message: string } }
  | { type: "add_position"; payload: { position: StudyPosition } }
  | { type: "update_position"; payload: { position: StudyPosition } }
  | { type: "delete_position"; payload: { id: string } }
  | { type: "select_position"; payload: { id: string | null } }
  | { type: "revert_positions"; payload: { positions: StudyPosition[] } }
  | { type: "clear_error" };

export const initialState: StudyPositionsState = {
  positions: [],
  selectedId: null,

  isLoading: false,
  isLoaded: false,
  isSaving: false,

  error: null,
};

function selectAfterReplace(
  positions: StudyPosition[],
  prevSelectedId: string | null,
): string | null {
  if (!positions.length) return null;
  if (prevSelectedId && positions.some((p) => p.id === prevSelectedId)) {
    return prevSelectedId;
  }
  return positions[0]!.id;
}

export function reducer(
  state: StudyPositionsState,
  action: Action,
): StudyPositionsState {
  switch (action.type) {
    case "load_start":
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case "load_success": {
      const positions = action.payload.positions;
      return {
        ...state,
        positions,
        selectedId: selectAfterReplace(positions, state.selectedId),
        isLoading: false,
        isLoaded: true,
        error: null,
      };
    }

    case "load_error":
      return {
        ...state,
        isLoading: false,
        isLoaded: true,
        error: action.payload.message,
      };

    case "save_start":
      return {
        ...state,
        isSaving: true,
        error: null,
      };

    case "save_success":
      return {
        ...state,
        isSaving: false,
      };

    case "save_error":
      return {
        ...state,
        isSaving: false,
        error: action.payload.message,
      };

    case "add_position": {
      const nextPositions = [action.payload.position, ...state.positions];
      return {
        ...state,
        positions: nextPositions,
        selectedId: action.payload.position.id,
      };
    }

    case "update_position": {
      const nextPositions = state.positions.map((p) =>
        p.id === action.payload.position.id ? action.payload.position : p,
      );

      return {
        ...state,
        positions: nextPositions,
      };
    }

    case "delete_position": {
      const nextPositions = state.positions.filter(
        (p) => p.id !== action.payload.id,
      );

      const selectedId =
        state.selectedId === action.payload.id
          ? (nextPositions[0]?.id ?? null)
          : state.selectedId;

      return {
        ...state,
        positions: nextPositions,
        selectedId,
      };
    }

    case "select_position":
      return {
        ...state,
        selectedId: action.payload.id,
      };

    case "revert_positions": {
      const positions = action.payload.positions;
      return {
        ...state,
        positions,
        selectedId: selectAfterReplace(positions, state.selectedId),
      };
    }

    case "clear_error":
      return {
        ...state,
        error: null,
      };

    default:
      return state;
  }
}
