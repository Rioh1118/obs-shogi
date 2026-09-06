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
import type { OpenProjectOutput, SearchPositionInput } from "../api/contract";
import type {
  IndexProgressPayload,
  IndexStatePayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchEndPayload,
  SearchErrorPayload,
} from "../api/events";
import type { PositionHit, RequestId } from "../api/ids";

import { isAppendOnlyContinuation } from "@/shared/lib/appendOnly";

import { createChunkBuffer, type ChunkBufferApi } from "./chunkBuffer";
import { PositionSearchContext } from "./context";
import { initialState, reducer, type DropSearchAction } from "./reducer";
import type { PositionSearchContextType, SearchLaunch, SearchSession } from "./types";

const EMPTY_HITS: PositionHit[] = [];

type HitsCacheEntry = {
  /**
   * 直前に取り込んだチャンクの実体。
   *
   * **チャンクを入れている配列の同一性では判定しない。** reducer は到着のたびに
   * `[...s.chunks, ...p.chunks]` で新しい配列へ差し替えるので、同一性で見ると
   * 増分追記は**一度も起きず**、毎回先頭から n 件を作り直すことになる。
   */
  lastChunk: PositionHit[] | null;
  consumed: number;
  /** 追記していく作業用。**呼び手へ渡すのはこれではない** */
  flat: PositionHit[];
  /** 呼び手へ渡した写し。同じ state を見ている間は同じものを返す */
  snapshot: PositionHit[];
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
   * 償却 O(n) の hits キャッシュ。到着ぶんが増えたら**末尾だけ**追記する。
   *
   * 同じ `sessions` を見ている間は同じ配列を返すので React の memo が効き、
   * 増えたときだけ別の配列になる。**どちらか片方だけでは成り立たない**——
   * 常に別の配列を返せば memo が毎回外れ、常に同じ配列を返せば増えたことが
   * 伝わらない。境目は `getHitsByRequestId` の中。
   */
  const hitsCacheRef = useRef(new Map<RequestId, HitsCacheEntry>());

  /**
   * 購読の試行が決着したか。**索引を開くのはこれが真になってから。**
   *
   * `listenSearchEvents` は `listen` の連なりで、登録の完了は IPC の往復を待つ。
   * 一方 `open_project` は入口で即 `Restoring` を emit する。宣言順は購読が
   * 「始まる」ことしか保証しないので、順序を守るものがコードに要る。
   * 取りこぼすと `index.state` は `"Empty"` のままになり、`indexStale` が偽になる。
   * 復元中に検索すると**0件が「完了・最新」として出る**。
   *
   * **「張れたか」ではなく「決着したか」。** 失敗でも真にする。購読が張れないことと
   * 索引が作られないことは別の失敗で、束ねると**購読の失敗が索引の構築まで巻き添えに
   * する**。索引はディスクにも残るので、次の起動で効いてくる。
   */
  const [isListenSettled, setIsListenSettled] = useState(false);

  // ---- チャンクの合流 ----

  /**
   * **同一性の変わらない1つの object。** 中身は `createChunkBuffer` の doc。
   * 依存に載せても effect が張り直らないので、購読の effect が
   * これを呼んでよい形になる。
   */
  const chunkBufferRef = useRef<ChunkBufferApi | null>(null);
  chunkBufferRef.current ??= createChunkBuffer(dispatch);
  const chunkBuffer = chunkBufferRef.current;

  useEffect(() => {
    // 対にする。**setup で開け直す**のは、畳んで張り直す経路（StrictMode の
    // 二重マウント）で閉じたまま残ると以後のチャンクが1つも積まれないため
    chunkBuffer.activate();
    return () => chunkBuffer.deactivate();
  }, [chunkBuffer]);

  /**
   * 検索の持ち物を落とす。**rid で引ける置き場は3つある**——溜め場（`chunkBuffer`）、
   * 平坦化のキャッシュ（`hitsCacheRef`）、`state.sessions`（reducer）。どれか1つに
   * 伝え忘れると、消えたはずのセッションが次の吐き出しで `ensureSession` に
   * 作り直される。
   *
   * **落とす合図まで受け取って、3つを同じ順でしか落とせない形にする**——入口を
   * 閉じるのが先、置き場を捨てるのが次、reducer が最後。呼び手に `dispatch` を
   * 書かせると、その順を変える改変が1行で書けてしまう。
   */
  const dropSearch = useCallback(
    (action: DropSearchAction) => {
      // **既定を破壊側にしない。** 三項で書くと、合図が3つ目に増えたときに
      // 黙って `undefined`（＝全部落とす）へ落ちる。ここで分類を迫る
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

          onSearchBegin: (p: SearchBeginPayload) => {
            // 溜め場は「これ以下の rid はもう受け取らない」の線を rid の最大値から
            // 引く。チャンクが1つも来なかった検索も数に入れる
            chunkBuffer.noteRequest(p.requestId);

            // **始まりも門を通す。** ここを通さないと、捨てた検索の begin が
            // `ensureSession` でセッションを作り直す
            if (!chunkBuffer.isAccepting(p.requestId)) return;
            dispatch({ type: "search_begin", payload: p });
          },
          onSearchChunk: chunkBuffer.enqueue,

          // **終わりと失敗は、溜めたぶんを吐き出してから。** 先に `isDone` を
          // 立てると、まだ届いていない結果を抱えたまま一覧が「完了」と名乗る。
          // 失敗のときも同じで、届いたぶんは残す
          onSearchEnd: (p: SearchEndPayload) => {
            chunkBuffer.flush();
            dispatch({ type: "search_end", payload: p });
          },
          onSearchError: (p: SearchErrorPayload) => {
            chunkBuffer.flush();
            dispatch({ type: "search_error", payload: p });
          },
        });
        if (cancelled) {
          u();
          return;
        }
        unlisten = u;
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

  // --- actions ---
  const openProject = useCallback(
    async (rd: string): Promise<OpenProjectOutput> => {
      if (openInFlightRef.current) return openInFlightRef.current;

      dropSearch({ type: "open_start", payload: { rootDir: rd } });

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
    [dropSearch],
  );

  /**
   * 根そのものが入れ替わったときに索引を開き直す。
   * （棋譜1本ずつの差分は Rust 側の watcher が入れる。こちらは別経路）
   *
   * **撃つのは2回だけ。** 購読の試行が決着したとき（起動時の一発はこちら。根はそれまで
   * 保留される）と、`rootDir` prop が変わったとき。**どちらの依存も外さないこと。**
   * `isListenSettled` を外すと購読より先に開いてしまい、`Restoring` の最初の1発を
   * 取りこぼす。`rootDir` を外すとワークスペースを変えても開き直さない。
   *
   * 呼び出し側の再描画に頼らないのが要点。頼ると張り直しが「どの画面が描かれているか」と
   * 「`openProject` の同一性が変わったか」に乗る。どちらもこのスライスの外にあって、
   * 崩れても**索引が古いまま黙って動く**——検索は成功し、結果だけが実物と食い違う。
   *
   * **`openProject` は飛行中の open を根を見ずに1本へ畳む**（TODO(#430)）。
   * 前の open が終わる前に根が変わると、その回は空振りする。撃つ機会は上の2回しか
   * 無いので、空振りするとそのセッション中は開き直さない。
   *
   * 失敗はここでは出せない。`openError` に載るが読み手が居ない（F-17 / #403）。
   * 握り潰しているのではなく、出口がまだ無い。
   */
  useEffect(() => {
    if (!rootDir || !isListenSettled) return;
    void openProject(rootDir).catch(() => {
      // `open_error` に積まれている。ここで再度投げても拾う先が無い
    });
  }, [rootDir, isListenSettled, openProject]);

  const searchPosition = useCallback(
    async (input: SearchPositionInput): Promise<SearchLaunch> => {
      // **投げる前に世代を控える。** 番号が返るまでこの検索は溜め場から見えない
      // ——線は「見えている rid の最大」で引かれるので、待っている間に根が開き直ると
      // この検索は線の後ろに回り、消えたはずの根の結果が新しい state に混ざる
      const myGeneration = chunkBuffer.generation();

      const out = await searchPositionApi(input);

      if (chunkBuffer.generation() !== myGeneration) {
        // 待っている間に線が引かれた。この検索は state に一切残さないし、
        // Rust にも走らせ続けない
        chunkBuffer.stopAccepting(out.requestId);
        void cancelSearchApi(out.requestId).catch(() => {});
        return { status: "superseded" };
      }

      // **線はここでも進める。** `stopAccepting()` は「見た中で最大の rid」に線を引き、
      // それより手前は個別に覚えない（`dead` を空にする）。イベントで見た rid しか
      // 数えていないと、`clear_search` に渡された rid が線を追い越して忘れられ、
      // 以後そのチャンクが通ってしまう
      chunkBuffer.noteRequest(out.requestId);

      dispatch({
        type: "search_requested",
        payload: {
          requestId: out.requestId,
          sfen: input.sfen,
          consistency: input.consistency,
        },
      });

      return { status: "started", requestId: out.requestId };
    },
    [chunkBuffer],
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

      const chunks = session.chunks;
      if (chunks.length === 0) return EMPTY_HITS;

      const cache = hitsCacheRef.current.get(requestId);

      // 前に取り込んだところまでが、いまの並びの先頭とそのまま一致しているか。
      // 一致していれば末尾だけ足せばよい
      const canAppend =
        !!cache && isAppendOnlyContinuation(chunks, cache.consumed, cache.lastChunk);

      if (canAppend && cache.consumed === chunks.length) return cache.snapshot;

      const flat = canAppend ? cache.flat : [];
      const start = canAppend ? cache.consumed : 0;
      for (let i = start; i < chunks.length; i++) {
        const chunk = chunks[i];
        for (let j = 0; j < chunk.length; j++) flat.push(chunk[j]);
      }

      // **写しを渡す。** `flat` は増分追記のために同じ配列を伸ばし続けるので、
      // 直に返すと呼び手の `useMemo` が「変わっていない」と読み、
      // **新着ヒットが一覧に出ない**。写しは要素の指し直しだけ（n=100,000 で
      // 0.035ms。`.claude/reviews/2026-09-07-447-position-search-perf-r1.md` M-4）
      // なので、増分追記の意味は消えない
      const snapshot = flat.slice();

      hitsCacheRef.current.set(requestId, {
        lastChunk: chunks[chunks.length - 1],
        consumed: chunks.length,
        flat,
        snapshot,
      });
      return snapshot;
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
