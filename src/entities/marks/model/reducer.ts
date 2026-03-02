import type { FileMarks, MarkEntry, MarksState, MarksStore } from "./types";

export type MarksAction =
  | { type: "loading" }
  | { type: "loaded"; payload: MarksStore }
  | { type: "error"; payload: string }
  | {
      type: "upsert";
      payload: {
        absPath: string;
        tesuuPointer: string;
        entry: MarkEntry;
      };
    }
  | {
      type: "delete";
      payload: {
        absPath: string;
        tesuuPointer: string;
      };
    };

export const initialState: MarksState = {
  store: { files: {} },
  isLoading: false,
  error: null,
};

export function reducer(state: MarksState, action: MarksAction): MarksState {
  switch (action.type) {
    case "loading":
      return { ...state, isLoading: true, error: null };

    case "loaded":
      return { store: action.payload, isLoading: false, error: null };

    case "error":
      return { ...state, isLoading: false, error: action.payload };

    case "upsert": {
      const { absPath, tesuuPointer, entry } = action.payload;
      const fileMarks: FileMarks = {
        ...(state.store.files[absPath] ?? {}),
        [tesuuPointer]: entry,
      };
      return {
        ...state,
        store: {
          files: {
            ...state.store.files,
            [absPath]: fileMarks,
          },
        },
      };
    }

    case "delete": {
      const { absPath, tesuuPointer } = action.payload;
      const fileMarks = { ...(state.store.files[absPath] ?? {}) };
      delete fileMarks[tesuuPointer];
      return {
        ...state,
        store: {
          files: {
            ...state.store.files,
            [absPath]: fileMarks,
          },
        },
      };
    }

    default:
      return state;
  }
}
