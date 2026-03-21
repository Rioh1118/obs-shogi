import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { loadStudyPositions, saveStudyPositions } from "../api/studyPositions";
import { sfenToPositionKey } from "../lib/sfenToPositionKey";
import { StudyPositionsContext } from "./context";
import type { StudyPositionsContextType } from "./context";
import { initialState, reducer } from "./reducer";
import type {
  CreateStudyPositionInput,
  StudyPosition,
  UpdateStudyPositionInput,
} from "./types";

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const tag of tags) {
    const v = tag.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }

  return out;
}

function normalizeStoredPosition(position: StudyPosition): StudyPosition {
  return {
    ...position,
    sfen: position.sfen.trim(), // 4トークンSFENを保持
    label: position.label.trim(),
    description: position.description.trim(),
    tags: normalizeTags(position.tags),
  };
}

function createNowIso(): string {
  return new Date().toISOString();
}

function createId(): string {
  return crypto.randomUUID();
}

function requirePositionKey(sfen: string): string {
  const key = sfenToPositionKey(sfen);
  if (!key) {
    throw new Error("Invalid SFEN");
  }
  return key;
}

export function StudyPositionsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const positionsRef = useRef<StudyPosition[]>([]);
  useEffect(() => {
    positionsRef.current = state.positions;
  }, [state.positions]);

  const persistPositions = useCallback(async (positions: StudyPosition[]) => {
    dispatch({ type: "save_start" });
    try {
      await saveStudyPositions({ positions });
      dispatch({ type: "save_success" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: "save_error", payload: { message } });
      throw e;
    }
  }, []);

  const load = useCallback(async () => {
    dispatch({ type: "load_start" });

    try {
      const out = await loadStudyPositions();
      const normalized = out.positions.map(normalizeStoredPosition);

      dispatch({
        type: "load_success",
        payload: { positions: normalized },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: "load_error", payload: { message } });
      throw e;
    }
  }, []);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    load().catch((e) => {
      console.error("[StudyPositions] load failed:", e);
    });
  }, [load]);

  const getById = useCallback(
    (id: string | null | undefined): StudyPosition | null => {
      if (!id) return null;
      return positionsRef.current.find((p) => p.id === id) ?? null;
    },
    [],
  );

  const findBySfen = useCallback(
    (sfen: string | null | undefined): StudyPosition | null => {
      if (!sfen) return null;

      const key = sfenToPositionKey(sfen);
      if (!key) return null;

      return (
        positionsRef.current.find((p) => sfenToPositionKey(p.sfen) === key) ??
        null
      );
    },
    [],
  );

  const addPosition = useCallback(
    async (input: CreateStudyPositionInput): Promise<StudyPosition> => {
      const inputKey = requirePositionKey(input.sfen);

      const duplicated = positionsRef.current.find(
        (p) => sfenToPositionKey(p.sfen) === inputKey,
      );
      if (duplicated) {
        throw new Error("Study position already exists for this position");
      }

      const now = createNowIso();

      const position: StudyPosition = normalizeStoredPosition({
        id: createId(),
        sfen: input.sfen,
        label: input.label,
        description: input.description,
        state: input.state,
        tags: input.tags,
        createdAt: now,
        updatedAt: now,
      });

      const prevPositions = positionsRef.current;
      const nextPositions = [position, ...prevPositions];

      dispatch({ type: "add_position", payload: { position } });
      positionsRef.current = nextPositions;

      try {
        await persistPositions(nextPositions);
        return position;
      } catch (e) {
        dispatch({
          type: "revert_positions",
          payload: { positions: prevPositions },
        });
        positionsRef.current = prevPositions;
        throw e;
      }
    },
    [persistPositions],
  );

  const updatePosition = useCallback(
    async (input: UpdateStudyPositionInput): Promise<StudyPosition> => {
      const current = positionsRef.current.find((p) => p.id === input.id);
      if (!current) {
        throw new Error("Study position not found");
      }

      const next: StudyPosition = normalizeStoredPosition({
        ...current,
        ...input,
        sfen: input.sfen != null ? input.sfen : current.sfen,
        updatedAt: createNowIso(),
      });

      const nextKey = requirePositionKey(next.sfen);

      const duplicated = positionsRef.current.find(
        (p) => p.id !== input.id && sfenToPositionKey(p.sfen) === nextKey,
      );
      if (duplicated) {
        throw new Error(
          "Another study position already exists for this position",
        );
      }

      const prevPositions = positionsRef.current;
      const nextPositions = prevPositions.map((p) =>
        p.id === next.id ? next : p,
      );

      dispatch({ type: "update_position", payload: { position: next } });
      positionsRef.current = nextPositions;

      try {
        await persistPositions(nextPositions);
        return next;
      } catch (e) {
        dispatch({
          type: "revert_positions",
          payload: { positions: prevPositions },
        });
        positionsRef.current = prevPositions;
        throw e;
      }
    },
    [persistPositions],
  );

  const deletePosition = useCallback(
    async (id: string): Promise<void> => {
      const prevPositions = positionsRef.current;
      const exists = prevPositions.some((p) => p.id === id);
      if (!exists) return;

      const nextPositions = prevPositions.filter((p) => p.id !== id);

      dispatch({ type: "delete_position", payload: { id } });
      positionsRef.current = nextPositions;

      try {
        await persistPositions(nextPositions);
      } catch (e) {
        dispatch({
          type: "revert_positions",
          payload: { positions: prevPositions },
        });
        positionsRef.current = prevPositions;
        throw e;
      }
    },
    [persistPositions],
  );

  const selectPosition = useCallback((id: string | null) => {
    dispatch({ type: "select_position", payload: { id } });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const value = useMemo<StudyPositionsContextType>(
    () => ({
      state,
      load,
      reload,
      addPosition,
      updatePosition,
      deletePosition,
      getById,
      findBySfen,
      selectPosition,
      clearError,
    }),
    [
      state,
      load,
      reload,
      addPosition,
      updatePosition,
      deletePosition,
      getById,
      findBySfen,
      selectPosition,
      clearError,
    ],
  );

  return (
    <StudyPositionsContext.Provider value={value}>
      {children}
    </StudyPositionsContext.Provider>
  );
}
