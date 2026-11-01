import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  openProject as openProjectApi,
  listenSearchEvents,
  searchPosition as searchPositionApi,
  cancelSearch as cancelSearchApi,
} from "../api/tauri";
import type { SearchPositionInput } from "../api/contract";
import type { PositionHit, RequestId } from "../api/ids";

import { createChunkBuffer, type ChunkBuffer } from "./chunkBuffer";
import { PositionSearchContext } from "./context";
import { flattenHits, type HitsCache } from "./hitsCache";
import { initialState, reducer, type DropSearchAction } from "./reducer";
import type { PositionSearchContextType, SearchLaunch, SearchSession } from "./types";

const EMPTY_HITS: PositionHit[] = [];

/**
 * 局面検索の state と、索引を開く操作を持つ。
 *
 * 根は prop で受ける。自分で `useAppConfig` を読むと、`AppConfigProvider` の下に置く制約が
 * prop でも型でも読めなくなる。流し込むのは `src/app/providers/gates/SearchRootGate.tsx`。
 */
export function PositionSearchProvider({
  rootDir,
  children,
}: {
  rootDir: string | null;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const isOpenInFlightRef = useRef(false);

  const hitsCacheRef = useRef<HitsCache>(new Map());

  /**
   * 購読の試行が決着したか。索引を開くのはこれが真になってからにする。
   *
   * `open_project` は呼ばれるとすぐ `Restoring` を emit する。購読の登録は IPC の往復を待つので、
   * 先に開くとこの通知を取りこぼし、復元が進んでいるのに「索引がありません」と出続ける。
   *
   * 購読に失敗しても真にする。待ちに含めると索引の構築まで止まる。索引はディスクに残るので、
   * 購読できなくても次の起動で使える。
   */
  const [isListenSettled, setIsListenSettled] = useState(false);

  /** 描画をまたいで同じものを使う。effect の依存に載せても購読が張り直らない */
  const chunkBufferRef = useRef<ChunkBuffer | null>(null);
  chunkBufferRef.current ??= createChunkBuffer(dispatch);
  const chunkBuffer = chunkBufferRef.current;

  /**
   * 検索の持ち物を `chunkBuffer`、`hitsCacheRef`、`state.sessions` から落とす。
   *
   * 1つでも残すと、消えたセッションが次の dispatch で `sessionOrNew` に作り直される。
   * 順は受け取りの停止、キャッシュ、reducer。dispatch まで受け持ち、呼び手が順を変えられない形にする。
   */
  const dropSearch = useCallback(
    (action: DropSearchAction) => {
      // 三項で書かない。アクションが増えたとき `undefined`（全部落とす）へ黙って落ちる
      let requestId: RequestId | undefined;
      switch (action.type) {
        case "open_start":
          requestId = undefined;
          break;
        case "clear_search":
          requestId = action.payload.requestId;
          break;
        default: {
          const exhaustive: never = action;
          return exhaustive;
        }
      }

      chunkBuffer.stopAccepting(requestId);
      if (requestId == null) hitsCacheRef.current.clear();
      else hitsCacheRef.current.delete(requestId);

      dispatch(action);
    },
    [chunkBuffer],
  );

  const openProject = useCallback(
    async (root: string) => {
      if (isOpenInFlightRef.current) return;
      isOpenInFlightRef.current = true;

      dropSearch({ type: "open_start" });

      try {
        await openProjectApi(root);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        dispatch({ type: "open_error", payload: { message } });
      } finally {
        isOpenInFlightRef.current = false;
      }
    },
    [dropSearch],
  );

  const searchPosition = useCallback(
    async (input: SearchPositionInput): Promise<SearchLaunch> => {
      // 番号が返るまで `chunkBuffer` はこの検索を知らない。待っている間に根が開き直されても
      // `firstLiveRid` はこの rid より前に留まるので、世代を控えて見張る
      const myGeneration = chunkBuffer.generation();

      const out = await searchPositionApi(input);

      // イベントより先に数える。`stopAccepting()` は `maxSeenRid` まで `firstLiveRid` を進めて
      // `droppedRids` を空にするので、数えていない rid を捨てた後に開き直すとチャンクが通る
      chunkBuffer.noteRequest(out.requestId);

      if (chunkBuffer.generation() !== myGeneration) {
        // 開き直された根の state に前の根の検索を残さない
        chunkBuffer.stopAccepting(out.requestId);
        void cancelSearchApi(out.requestId).catch(() => {});
        return { status: "superseded" };
      }

      dispatch({ type: "search_requested", payload: { requestId: out.requestId } });

      return { status: "started", requestId: out.requestId };
    },
    [chunkBuffer],
  );

  const cancelSearch = useCallback(async (requestId: RequestId) => {
    try {
      await cancelSearchApi(requestId);
    } catch (e) {
      // ここへ来るのは IPC の失敗だけ。結果は呼び手が `clearSearch` で捨てる
      // eslint-disable-next-line no-console
      console.error("[SEARCH] cancelSearch failed:", e);
    }
  }, []);

  const getSessionByRequestId = useCallback(
    (requestId: RequestId | null): SearchSession | null => {
      if (requestId == null) return null;
      return state.sessions[requestId] ?? null;
    },
    [state.sessions],
  );

  const getHitsByRequestId = useCallback(
    (requestId: RequestId | null): PositionHit[] => {
      if (requestId == null) return EMPTY_HITS;
      const session = state.sessions[requestId];
      if (!session) return EMPTY_HITS;

      if (session.chunks.length === 0) return EMPTY_HITS;

      return flattenHits(hitsCacheRef.current, requestId, session.chunks);
    },
    [state.sessions],
  );

  const isSearchingRequest = useCallback(
    (requestId: RequestId | null): boolean => {
      if (requestId == null) return false;
      const s = state.sessions[requestId];
      return !!s && !s.isDone;
    },
    [state.sessions],
  );

  const resolveHitAbsPath = useCallback(
    (hit: PositionHit): string | null => state.filePathById[hit.occ.fileId] ?? null,
    [state.filePathById],
  );

  const clearWarns = useCallback(() => dispatch({ type: "clear_warns" }), []);
  const clearSearch = useCallback(
    (requestId: RequestId) => dropSearch({ type: "clear_search", payload: { requestId } }),
    [dropSearch],
  );

  const value = useMemo<PositionSearchContextType>(
    () => ({
      state,
      searchPosition,
      cancelSearch,
      getSessionByRequestId,
      getHitsByRequestId,
      isSearchingRequest,
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
      resolveHitAbsPath,
      clearWarns,
      clearSearch,
    ],
  );

  useEffect(() => {
    // 開け直すのは StrictMode の二重マウントのため。閉じたままだと以後のチャンクが積まれない
    chunkBuffer.activate();
    return () => chunkBuffer.deactivate();
  }, [chunkBuffer]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        const unlistenAll = await listenSearchEvents({
          onIndexState: (p) => dispatch({ type: "index_state", payload: p }),
          onIndexProgress: (p) => dispatch({ type: "index_progress", payload: p }),
          onIndexWarn: (p) => dispatch({ type: "index_warn", payload: p }),

          onSearchBegin: (p) => {
            // チャンクが1つも来なかった検索も `maxSeenRid` に数える
            chunkBuffer.noteRequest(p.requestId);

            // 捨てた検索の begin で `sessionOrNew` がセッションを作り直さないようにする
            if (!chunkBuffer.isAccepting(p.requestId)) return;
            dispatch({ type: "search_begin", payload: p });
          },
          onSearchChunk: chunkBuffer.enqueue,

          // 先に吐き出す。逆だと溜めた結果を抱えたまま一覧が完了と出る。失敗でも届いた分は残す
          onSearchEnd: (p) => {
            chunkBuffer.flush();
            dispatch({ type: "search_end", payload: p });
          },
          onSearchError: (p) => {
            chunkBuffer.flush();
            dispatch({ type: "search_error", payload: p });
          },
        });
        if (cancelled) {
          unlistenAll();
          return;
        }
        unlisten = unlistenAll;
        setIsListenSettled(true);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[SEARCH] Failed to setup listeners:", e);
        if (cancelled) return;
        setIsListenSettled(true);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }, [chunkBuffer]);

  /**
   * 根が変わったら索引を開き直す。棋譜1本ずつの差分は Rust の watcher が入れる。
   *
   * 動くのは購読の試行が決着したときと、`rootDir` が変わったときの2つ。呼び手の再描画に頼ると
   * 開き直しが画面の描かれ方に左右され、索引が古いまま検索だけが成功する。
   * `isListenSettled` を依存から外すと購読より先に開き、`rootDir` を外すとワークスペースを
   * 変えても開き直さない。
   *
   * TODO(#430): `openProject` は進行中の open があると根を見ずに戻るので、その間に根が変わると
   * そのセッション中は開き直さない。
   *
   * TODO(#403): 失敗は `openError` に載るが、読み手がまだ無い。
   */
  useEffect(() => {
    if (!rootDir || !isListenSettled) return;
    void openProject(rootDir);
  }, [rootDir, isListenSettled, openProject]);

  return <PositionSearchContext.Provider value={value}>{children}</PositionSearchContext.Provider>;
}
