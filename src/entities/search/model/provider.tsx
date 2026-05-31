import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { useAppConfig } from "@/entities/app-config";
import { usePositionSync } from "@/app/providers/bridges/position-sync";

import {
  openProject as openProjectApi,
  listenSearchEvents,
  searchPosition as searchPositionApi,
  cancelSearch as cancelSearchApi,
} from "../api/tauri";
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
import type { PositionHit, RequestId } from "../api/ids";

import { PositionSearchContext } from "./context";
import { initialState, reducer } from "./reducer";
import type { PositionSearchContextType, SearchSession } from "./types";

const EMPTY_HITS: PositionHit[] = [];

type HitsCacheEntry = {
  chunksRef: PositionHit[][];
  consumed: number;
  flat: PositionHit[];
};

export function PositionSearchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const { config } = useAppConfig();
  const { currentSfen } = usePositionSync();

  const openInFlightRef = useRef<Promise<OpenProjectOutput> | null>(null);

  /**
   * 償却 O(n) の hits キャッシュ (C-M1)。session.chunks に新規 chunk が増えたら
   * 末尾だけ flat 配列に append する。同一 chunks 参照を見ている間は flat 配列も
   * stable で React の memo が効く。
   */
  const hitsCacheRef = useRef(new Map<RequestId, HitsCacheEntry>());

  // ---- event listeners (StrictMode-safe: outer scope cancelled flag) ----
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    (async () => {
      try {
        const u = await listenSearchEvents({
          onIndexState: (p: IndexStatePayload) => dispatch({ type: "index_state", payload: p }),
          onIndexProgress: (p: IndexProgressPayload) =>
            dispatch({ type: "index_progress", payload: p }),
          onIndexWarn: (p: IndexWarnPayload) => dispatch({ type: "index_warn", payload: p }),

          onSearchBegin: (p: SearchBeginPayload) => dispatch({ type: "search_begin", payload: p }),
          onSearchChunk: (p: SearchChunkPayload) => dispatch({ type: "search_chunk", payload: p }),
          onSearchEnd: (p: SearchEndPayload) => dispatch({ type: "search_end", payload: p }),
          onSearchError: (p: SearchErrorPayload) => dispatch({ type: "search_error", payload: p }),
        });
        if (cancelled) {
          u();
          return;
        }
        unlisten = u;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[SEARCH] Failed to setup listeners:", e);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }, []);

  // --- actions ---
  const openProject = useCallback(
    async (rootDir?: string): Promise<OpenProjectOutput> => {
      const rd = rootDir ?? config?.root_dir ?? null;
      if (!rd) throw new Error("root_dir is not set");

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
          requestId: out.requestId,
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
        chunkSize: opts?.chunkSize ?? 300,
      });
    },
    [currentSfen, searchPosition],
  );

  const cancelSearch = useCallback(async (requestId: RequestId) => {
    try {
      await cancelSearchApi(requestId);
    } catch (e) {
      // ベストエフォート。 既に終了している rid に対する cancel は no-op として通る。
      // eslint-disable-next-line no-console
      console.error("[SEARCH] cancelSearch failed:", e);
    }
  }, []);

  const getSessionByRequestId = useCallback(
    (requestId: RequestId | null | undefined): SearchSession | null => {
      if (requestId == null) return null;
      return state.sessions[requestId] ?? null;
    },
    [state.sessions],
  );

  const getHitsByRequestId = useCallback(
    (requestId: RequestId | null | undefined): PositionHit[] => {
      if (requestId == null) return EMPTY_HITS;
      const session = state.sessions[requestId];
      if (!session) return EMPTY_HITS;

      const cache = hitsCacheRef.current.get(requestId);
      if (cache && cache.chunksRef === session.chunks && cache.consumed === session.chunks.length) {
        return cache.flat;
      }

      const flat: PositionHit[] = cache && cache.chunksRef === session.chunks ? cache.flat : [];
      const start = cache && cache.chunksRef === session.chunks ? cache.consumed : 0;
      for (let i = start; i < session.chunks.length; i++) {
        const chunk = session.chunks[i];
        for (let j = 0; j < chunk.length; j++) flat.push(chunk[j]);
      }

      hitsCacheRef.current.set(requestId, {
        chunksRef: session.chunks,
        consumed: session.chunks.length,
        flat,
      });
      return flat;
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
    (hit: PositionHit): string | null => state.filePathById[hit.occ.fileId] ?? null,
    [state.filePathById],
  );

  const clearWarns = useCallback(() => dispatch({ type: "clear_warns" }), []);
  const clearSearch = useCallback((requestId: RequestId) => {
    hitsCacheRef.current.delete(requestId);
    dispatch({ type: "clear_search", payload: { requestId } });
  }, []);

  const value = useMemo<PositionSearchContextType>(
    () => ({
      state,
      openProject,
      searchPosition,
      searchCurrentPositionBestEffort,
      cancelSearch,
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
      cancelSearch,
      getSessionByRequestId,
      getHitsByRequestId,
      isSearchingRequest,
      getAbsPathByFileId,
      resolveHitAbsPath,
      clearWarns,
      clearSearch,
    ],
  );

  return <PositionSearchContext.Provider value={value}>{children}</PositionSearchContext.Provider>;
}
