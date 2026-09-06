import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import {
  openProject as openProjectApi,
  listenSearchEvents,
  searchPosition as searchPositionApi,
  cancelSearch as cancelSearchApi,
} from "../api/tauri";
import type { OpenProjectOutput, SearchPositionInput, SearchPositionOutput } from "../api/contract";
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

/**
 * 局面検索の state と索引の口。
 *
 * **根は prop で受け取る。** 自分で `useAppConfig` を読むと、このスライスが
 * 起動シーケンスを持つことになり、`AppConfigProvider` の下に置く制約が
 * 呼び出し側からは prop でも型でも読めなくなる。流し込むのは
 * `src/app/providers/gates/SearchRootGate.tsx`（`FileTreeRootGate` と同じ形）。
 */
export function PositionSearchProvider({
  rootDir,
  children,
}: {
  rootDir: string | null;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const openInFlightRef = useRef<Promise<OpenProjectOutput> | null>(null);

  /**
   * 償却 O(n) の hits キャッシュ。session.chunks に新規 chunk が増えたら
   * 末尾だけ flat 配列に append する。同一 chunks 参照を見ている間は flat 配列も
   * stable で React の memo が効く。
   */
  const hitsCacheRef = useRef(new Map<RequestId, HitsCacheEntry>());

  /**
   * 購読が張り終わったか。**索引を開くのはこれが真になってから。**
   *
   * `listenSearchEvents` は `listen` の連なりで、登録の完了は IPC の往復を待つ。
   * 一方 `open_project` は入口で即 `Restoring` を emit する。宣言順は購読が
   * 「始まる」ことしか保証しないので、順序を守るものがコードに要る。
   *
   * 取りこぼすと `index.state` は `"Empty"` のままになり、`indexStale` が偽になる。
   * 復元中に検索すると**0件が「完了・最新」として出る**。
   */
  const [isListening, setIsListening] = useState(false);

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
        setIsListening(true);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[SEARCH] Failed to setup listeners:", e);
      }
    })();

    return () => {
      cancelled = true;
      setIsListening(false);
      unlisten?.();
      unlisten = null;
    };
  }, []);

  // --- actions ---
  const openProject = useCallback(async (rd: string): Promise<OpenProjectOutput> => {
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
  }, []);

  /**
   * 根そのものが入れ替わったときに索引を開き直す。**その合図は `rootDir` prop だけ。**
   * （棋譜1本ずつの差分は Rust 側の watcher が入れる。こちらは別経路）
   *
   * 呼び出し側の再描画に頼ると、張り直しが「どの画面が描かれているか」と
   * 「`openProject` の同一性が変わったか」に乗る。どちらもこのスライスの外にあって、
   * 崩れても**索引が古いまま黙って動く**——検索は成功し、結果だけが実物と食い違う。
   *
   * **`openProject` は飛行中の open を根を見ずに1本へ畳む**（TODO(#430)）。
   * 前の open が終わる前に根が変わると、この effect は空振りする。
   * この effect が撃つのは根が変わった一度きりなので、そこで落ちると
   * そのセッション中は二度と開かない。
   *
   * 失敗はここでは出せない。`openError` に載るが読み手が居ない（F-17 / #403）。
   * 握り潰しているのではなく、出口がまだ無い。
   */
  useEffect(() => {
    if (!rootDir || !isListening) return;
    void openProject(rootDir).catch(() => {
      // `open_error` に積まれている。ここで再度投げても拾う先が無い
    });
  }, [rootDir, isListening, openProject]);

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
      searchPosition,
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
      searchPosition,
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
