import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { MarksContext } from "./context";
import { initialState, reducer } from "./reducer";
import type { FileMarks, MarkEntry, MarksContextType } from "./types";
import { loadMarks, saveMarks } from "../api/tauri";

export function MarksProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    dispatch({ type: "loading" });
    loadMarks()
      .then((store) => dispatch({ type: "loaded", payload: store }))
      .catch((e) =>
        dispatch({ type: "error", payload: `marks の読み込みに失敗: ${String(e)}` }),
      );
  }, []);

  const getFileMarks = useCallback(
    (absPath: string): FileMarks => {
      return state.store.files[absPath] ?? {};
    },
    [state.store.files],
  );

  const upsertMark = useCallback(
    async (
      absPath: string,
      tesuuPointer: string,
      patch: Partial<MarkEntry> & { id: string; tesuu: number; moveText: string },
    ) => {
      const existing = state.store.files[absPath]?.[tesuuPointer];
      const defaults = { level: 0 as const, tags: [] as MarkEntry["tags"], note: "" };
      const entry: MarkEntry = {
        ...defaults,
        ...existing,
        ...patch,
      };

      dispatch({ type: "upsert", payload: { absPath, tesuuPointer, entry } });

      const nextStore = {
        files: {
          ...state.store.files,
          [absPath]: {
            ...(state.store.files[absPath] ?? {}),
            [tesuuPointer]: entry,
          },
        },
      };
      await saveMarks(nextStore).catch((e) =>
        console.error("save_marks failed:", e),
      );
    },
    [state.store.files],
  );

  const deleteMark = useCallback(
    async (absPath: string, tesuuPointer: string) => {
      dispatch({ type: "delete", payload: { absPath, tesuuPointer } });

      const nextFileMarks = { ...(state.store.files[absPath] ?? {}) };
      delete nextFileMarks[tesuuPointer];
      const nextStore = {
        files: {
          ...state.store.files,
          [absPath]: nextFileMarks,
        },
      };
      await saveMarks(nextStore).catch((e) =>
        console.error("save_marks failed:", e),
      );
    },
    [state.store.files],
  );

  const value: MarksContextType = useMemo(
    () => ({ state, getFileMarks, upsertMark, deleteMark }),
    [state, getFileMarks, upsertMark, deleteMark],
  );

  return (
    <MarksContext.Provider value={value}>{children}</MarksContext.Provider>
  );
}
