import {
  openProject as openProjectApi,
  listenSearchEvents,
  searchPosition as searchPositionApi,
} from "../api/tauri";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { initialState, reducer } from "./reducer";
import { useAppConfig } from "@/entities/app-config";
import { usePositionSync } from "@/app/providers/bridges/position-sync";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type {
  Consistency,
  OpenProjectOutput,
  SearchPositionInput,
  SearchPositionOutput,
} from "../api/contract";
import type {
  IndexProgressPayload,
  IndexStatePayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchChunkPayload,
  SearchEndPayload,
  SearchErrorPayload,
} from "../api/events";
import type { PositionSearchContextType, SearchSession } from "./types";
import type { PositionHit, RequestId } from "../api/ids";
import { PositionSearchContext } from "./context";

export function PositionSearchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const { config } = useAppConfig();
  const { currentSfen } = usePositionSync();

  const unlistenRef = useRef<UnlistenFn | null>(null);

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
          const out = await openProjectApi(rd);
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
      const out = await searchPositionApi(input);

      dispatch({
        type: "search_requested",
        payload: {
          requestId: out.request_id,
          sfen: input.sfen,
          consistency: input.consistency,
        },
      });

      return out;
    },
    [],
  );

  const searchCurrentPositionBestEffort = useCallback(
    async (opts?: {
      chunkSize?: number;
      consistency?: Consistency;
    }): Promise<SearchPositionOutput> => {
      if (!currentSfen) throw new Error("No current SFEN");
      return await searchPosition({
        sfen: currentSfen,
        consistency: opts?.consistency ?? "BestEffort",
        chunk_size: opts?.chunkSize ?? 5000,
      });
    },
    [currentSfen, searchPosition],
  );

  const getSessionByRequestId = useCallback(
    (requestId: RequestId | null | undefined): SearchSession | null => {
      if (requestId == null) return null;
      return state.sessions[requestId] ?? null;
    },
    [state.sessions],
  );

  const getHitsByRequestId = useCallback(
    (requestId: RequestId | null | undefined): PositionHit[] => {
      if (requestId == null) return [];
      return state.sessions[requestId]?.hits ?? [];
    },
    [state.sessions],
  );

  const isSearchingRequest = useCallback(
    (requestId: RequestId | null | undefined): boolean => {
      if (requestId == null) return false;
      const s = state.sessions[requestId];
      return !!s && !s.isDone;
    },
    [state.sessions],
  );

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
      getSessionByRequestId,
      getHitsByRequestId,
      isSearchingRequest,
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
      getSessionByRequestId,
      getHitsByRequestId,
      isSearchingRequest,
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
}
