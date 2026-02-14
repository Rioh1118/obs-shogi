import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";

import { useAppConfig } from "./AppConfigContext";
import { usePosition } from "./PositionContext";

import {
  openProject as openProjectCommand,
  searchPosition as searchPositionCommand,
  searchPositionBestEffort,
  listenSearchEvents,
} from "@/commands/search";

import type { UnlistenFn } from "@tauri-apps/api/event";

import type {
  OpenProjectOutput,
  SearchPositionInput,
  SearchPositionOutput,
  IndexStatePayload,
  IndexProgressPayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchChunkPayload,
  SearchEndPayload,
  SearchErrorPayload,
  RequestId,
  PositionHit,
} from "@/commands/search/types";

type IndexUiState = {
  state: IndexStatePayload["state"] | "Empty";
  dirtyCount: number;
  indexedFiles: number;
  totalFiles: number;
  currentPath: string | null;
};

type SearchSession = {
  requestId: RequestId;
  stale: boolean;
  isDone: boolean;
  error: string | null;
  hits: PositionHit[];
  startedAt: number;
  endedAt: number | null;
};

type FilePathById = Record<number, string>;

type SearchState = {
  // index
  index: IndexUiState;
  warns: IndexWarnPayload[];

  filePathById: FilePathById;

  // open project
  isOpeningProject: boolean;
  lastOpenedRootDir: string | null;
  lastOpenResult: OpenProjectOutput | null;
  openError: string | null;

  // search
  isSearching: boolean;
  currentRequestId: RequestId | null;
  sessions: Record<number, SearchSession>; // requestId -> session
};

type Action =
  // index events
  | { type: "index_state"; payload: IndexStatePayload }
  | { type: "index_progress"; payload: IndexProgressPayload }
  | { type: "index_warn"; payload: IndexWarnPayload }
  | { type: "clear_warns" }

  // open project lifecycle
  | { type: "open_start"; payload: { rootDir: string } }
  | { type: "open_ok"; payload: { rootDir: string; out: OpenProjectOutput } }
  | { type: "open_error"; payload: { message: string } }

  // search events
  | { type: "search_begin"; payload: SearchBeginPayload }
  | { type: "search_chunk"; payload: SearchChunkPayload }
  | { type: "search_end"; payload: SearchEndPayload }
  | { type: "search_error"; payload: SearchErrorPayload }
  | { type: "clear_search"; payload?: { requestId?: RequestId } };

const initialState: SearchState = {
  index: {
    state: "Empty",
    dirtyCount: 0,
    indexedFiles: 0,
    totalFiles: 0,
    currentPath: null,
  },
  warns: [],
  filePathById: {},

  isOpeningProject: false,
  lastOpenedRootDir: null,
  lastOpenResult: null,
  openError: null,

  isSearching: false,
  currentRequestId: null,
  sessions: {},
};

function ensureSession(
  sessions: Record<number, SearchSession>,
  requestId: RequestId,
): Record<number, SearchSession> {
  if (sessions[requestId]) return sessions;
  return {
    ...sessions,
    [requestId]: {
      requestId,
      stale: false,
      isDone: false,
      error: null,
      hits: [],
      startedAt: Date.now(),
      endedAt: null,
    },
  };
}

function mergeFiles(
  base: Record<number, string>,
  files: { file_id: number; abs_path: string }[],
): Record<number, string> {
  if (!files.length) return base;

  let changed = false;
  const next = { ...base };

  for (const f of files) {
    const prev = next[f.file_id];
    if (prev !== f.abs_path) {
      next[f.file_id] = f.abs_path;
      changed = true;
    }
  }

  return changed ? next : base;
}

function reducer(state: SearchState, action: Action): SearchState {
  switch (action.type) {
    // ===== index events =====
    case "index_state": {
      const p = action.payload;
      return {
        ...state,
        index: {
          ...state.index,
          state: p.state,
          dirtyCount: p.dirty_count,
          indexedFiles: p.indexed_files,
          totalFiles: p.total_files,
        },
      };
    }

    case "index_progress": {
      const p = action.payload;
      return {
        ...state,
        index: {
          ...state.index,
          currentPath: p.current_path,
        },
      };
    }

    case "index_warn": {
      return {
        ...state,
        warns: [...state.warns.slice(-199), action.payload],
      };
    }

    case "clear_warns":
      return { ...state, warns: [] };

    // ===== open project lifecycle =====
    case "open_start":
      return {
        ...state,
        isOpeningProject: true,
        lastOpenedRootDir: action.payload.rootDir,
        openError: null,
        lastOpenResult: null,
        filePathById: {},
        isSearching: false,
        currentRequestId: null,
        sessions: {},
      };

    case "open_ok":
      return {
        ...state,
        isOpeningProject: false,
        lastOpenedRootDir: action.payload.rootDir,
        lastOpenResult: action.payload.out,
        openError: null,
      };

    case "open_error":
      return {
        ...state,
        isOpeningProject: false,
        openError: action.payload.message,
      };

    // ===== search events =====
    case "search_begin": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;
      return {
        ...state,
        isSearching: true,
        currentRequestId: p.request_id,
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            stale: p.stale,
            isDone: false,
            error: null,
            startedAt: s.startedAt || Date.now(),
            endedAt: null,
          },
        },
      };
    }

    case "search_chunk": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;

      return {
        ...state,
        currentRequestId: state.currentRequestId ?? p.request_id,
        filePathById: mergeFiles(state.filePathById, p.files),
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            hits: [...s.hits, ...p.chunk],
          },
        },
      };
    }

    case "search_end": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;
      const isCurrent = state.currentRequestId === p.request_id;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            isDone: true,
            endedAt: Date.now(),
          },
        },
      };
    }

    case "search_error": {
      const p = action.payload;
      const sessions = ensureSession(state.sessions, p.request_id);
      const s = sessions[p.request_id]!;
      const isCurrent = state.currentRequestId === p.request_id;

      return {
        ...state,
        isSearching: isCurrent ? false : state.isSearching,
        sessions: {
          ...sessions,
          [p.request_id]: {
            ...s,
            error: p.message,
            isDone: true,
            endedAt: Date.now(),
          },
        },
      };
    }

    case "clear_search": {
      const rid = action.payload?.requestId;
      if (rid == null) {
        return {
          ...state,
          isSearching: false,
          currentRequestId: null,
          sessions: {},
        };
      }

      const next = { ...state.sessions };
      delete next[rid];

      const currentRequestId =
        state.currentRequestId === rid ? null : state.currentRequestId;

      return {
        ...state,
        isSearching: currentRequestId ? state.isSearching : false,
        currentRequestId,
        sessions: next,
      };
    }

    default:
      return state;
  }
}

type PositionSearchContextType = {
  state: SearchState;

  // actions
  openProject: (rootDir?: string) => Promise<OpenProjectOutput>;
  searchPosition: (input: SearchPositionInput) => Promise<SearchPositionOutput>;
  searchCurrentPositionBestEffort: (
    chunkSize?: number,
  ) => Promise<SearchPositionOutput>;

  // helpers
  getCurrentSession: () => SearchSession | null;
  getHits: () => PositionHit[];
  getAbsPathByFileId: (fileId: number) => string | null;
  resolveHitAbsPath: (hit: PositionHit) => string | null;

  clearWarns: () => void;
  clearSearch: (requestId?: RequestId) => void;
};

const PositionSearchContext = createContext<PositionSearchContextType | null>(
  null,
);

export const PositionSearchProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const { config } = useAppConfig();
  const { currentSfen } = usePosition();

  const unlistenRef = useRef<UnlistenFn | null>(null);

  // open 多重対策
  const openInFlightRef = useRef<Promise<OpenProjectOutput> | null>(null);

  // --- event listeners ---
  useEffect(() => {
    const setup = async () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      try {
        const unlisten = await listenSearchEvents({
          onIndexState: (p: IndexStatePayload) =>
            dispatch({ type: "index_state", payload: p }),
          onIndexProgress: (p: IndexProgressPayload) =>
            dispatch({ type: "index_progress", payload: p }),
          onIndexWarn: (p: IndexWarnPayload) =>
            dispatch({ type: "index_warn", payload: p }),

          onSearchBegin: (p: SearchBeginPayload) =>
            dispatch({ type: "search_begin", payload: p }),
          onSearchChunk: (p: SearchChunkPayload) =>
            dispatch({ type: "search_chunk", payload: p }),
          onSearchEnd: (p: SearchEndPayload) =>
            dispatch({ type: "search_end", payload: p }),
          onSearchError: (p: SearchErrorPayload) =>
            dispatch({ type: "search_error", payload: p }),
        });

        unlistenRef.current = unlisten;
      } catch (e) {
        console.error("[SEARCH] Failed to setup listeners:", e);
      }
    };

    setup().catch((e) => console.error("[SEARCH] setup failed:", e));

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // --- actions ---
  const openProject = useCallback(
    async (rootDir?: string): Promise<OpenProjectOutput> => {
      const rd = rootDir ?? config?.root_dir ?? null;
      if (!rd) throw new Error("root_dir is not set");

      // 多重実行防止（連打・useEffect二重発火対策）
      if (openInFlightRef.current) return openInFlightRef.current;

      dispatch({ type: "open_start", payload: { rootDir: rd } });

      openInFlightRef.current = (async () => {
        try {
          const out = await openProjectCommand(rd);
          dispatch({ type: "open_ok", payload: { rootDir: rd, out } });
          return out;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          dispatch({ type: "open_error", payload: { message: msg } });
          throw e;
        } finally {
          openInFlightRef.current = null;
        }
      })();

      return openInFlightRef.current;
    },
    [config?.root_dir],
  );

  const searchPosition = useCallback(
    async (input: SearchPositionInput): Promise<SearchPositionOutput> => {
      // ここでは invoke 結果を返すだけ。begin/chunk/end はイベントで state に積まれる。
      return await searchPositionCommand(input);
    },
    [],
  );

  const searchCurrentPositionBestEffort = useCallback(
    async (chunkSize: number = 5000): Promise<SearchPositionOutput> => {
      if (!currentSfen) throw new Error("No current SFEN");
      return await searchPositionBestEffort(currentSfen, chunkSize);
    },
    [currentSfen],
  );

  // --- helpers ---
  const getCurrentSession = useCallback((): SearchSession | null => {
    if (!state.currentRequestId) return null;
    return state.sessions[state.currentRequestId] ?? null;
  }, [state.currentRequestId, state.sessions]);

  const getHits = useCallback((): PositionHit[] => {
    const s = state.currentRequestId
      ? state.sessions[state.currentRequestId]
      : null;
    return s?.hits ?? [];
  }, [state.currentRequestId, state.sessions]);

  const getAbsPathByFileId = useCallback(
    (fileId: number): string | null => state.filePathById[fileId] ?? null,
    [state.filePathById],
  );
  const resolveHitAbsPath = useCallback(
    (hit: PositionHit): string | null =>
      state.filePathById[hit.occ.file_id] ?? null,
    [state.filePathById],
  );

  const clearWarns = useCallback(() => dispatch({ type: "clear_warns" }), []);
  const clearSearch = useCallback(
    (requestId?: RequestId) =>
      dispatch({ type: "clear_search", payload: { requestId } }),
    [],
  );

  const value = useMemo<PositionSearchContextType>(
    () => ({
      state,
      openProject,
      searchPosition,
      searchCurrentPositionBestEffort,
      getCurrentSession,
      getHits,
      getAbsPathByFileId,
      resolveHitAbsPath,
      clearWarns,
      clearSearch,
    }),
    [
      state,
      openProject,
      searchPosition,
      searchCurrentPositionBestEffort,
      getCurrentSession,
      getHits,
      getAbsPathByFileId,
      resolveHitAbsPath,
      clearWarns,
      clearSearch,
    ],
  );

  return (
    <PositionSearchContext.Provider value={value}>
      {children}
    </PositionSearchContext.Provider>
  );
};

export const usePositionSearch = () => {
  const ctx = useContext(PositionSearchContext);
  if (!ctx) {
    throw new Error(
      "usePositionSearch must be used within PositionSearchProvider",
    );
  }
  return ctx;
};
