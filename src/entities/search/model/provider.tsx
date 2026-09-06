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
import type { FilePathEntry, PositionHit, RequestId } from "../api/ids";

import { PositionSearchContext } from "./context";
import { initialState, reducer } from "./reducer";
import type { PositionSearchContextType, SearchSession } from "./types";

const EMPTY_HITS: PositionHit[] = [];

/**
 * 届いたチャンクを溜めておく時間（ms）。
 *
 * **1チャンク1レンダにしない。** Rust は `yield_now` を挟んで実時間に散らして
 * emit する（`src-tauri/src/search/query_service.rs`）ので、チャンクは結果の
 * 件数ぶん飛んでくる——既定の 300 件区切りなら n=100,000 で 334 回。1回ごとに
 * state を作り直すと、10万件の `filePathById` と一覧の平坦化を 334 回やり直す。
 *
 * 溜めると、その回数が**件数でなく経過時間**で決まるようになる。50ms は
 * 「結果が育っていくのが見える」ことと「回数の上限（20回/秒）」の折り合い。
 * 検索の完了・失敗はここを待たずに吐き出すので、終わりが遅れることはない。
 */
const CHUNK_FLUSH_MS = 50;

/** まだ dispatch していない到着ぶん */
type PendingChunks = { chunks: PositionHit[][]; files: FilePathEntry[] };

/**
 * 溜め場と、そこへ入れてよいかの門。
 *
 * **溜めたぶんを捨てるだけでは門にならない。** `open_start` はセッションを全部
 * 落とすが、Rust の `open_project` は進行中の検索を1つもキャンセルしない
 * （`src-tauri/src/search/commands.rs`）。その後も同じ rid のチャンクが届くので、
 * 入口で弾かないと `ensureSession` が消えたセッションを作り直し、
 * `currentRequestId` と `filePathById` が**古い根のものへ戻る**。
 *
 * 線は「これ以下の rid は受け取らない」で引く。rid は Rust 側で単調に増える
 * （`QueryService::next_request_id`）ので、線より後に始まった検索は必ず通る。
 * **通すのが既定**なので、`search_begin` を1発取りこぼしても結果が黙って
 * 0件になることはない。
 */
type ChunkBuffer = {
  pending: Map<RequestId, PendingChunks>;
  timer: number | null;
  /** 後片付け済み。**setup で偽に戻す**——畳んで張り直す経路で真のまま残ると全部落ちる */
  disposed: boolean;
  /** `open_start` が引いた線。これ以下の rid は受け取らない */
  deadBefore: RequestId;
  /** 明示的に捨てた rid（`clear_search`）。線より後のものだけがここに要る */
  dead: Set<RequestId>;
  /** 見た中で最大の rid。線を引く位置に使う */
  maxSeenRid: RequestId;
};

type HitsCacheEntry = {
  /**
   * 直前に取り込んだチャンクの実体。
   *
   * **チャンクを入れている配列の同一性では判定しない。** reducer は到着のたびに
   * `[...s.chunks, ...p.chunks]` で新しい配列へ差し替えるので、同一性で見ると
   * 増分追記は**一度も起きない**（この形が実際に O(n²) を作っていた）。
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
   * 溜め場とその起こし手を**1つの object にまとめて持つ**。同一性が変わらないので、
   * 後片付けの effect が `ref.current` を直に読まずに済む（読むと、片付けの時点で
   * 別の値になっている可能性を lint が咎める——ここでは起きないが、
   * 起きないことをコードで示せる形にしておく）。
   */
  const chunkBufferRef = useRef<ChunkBuffer>({
    pending: new Map(),
    timer: null,
    disposed: false,
    deadBefore: 0,
    dead: new Set(),
    maxSeenRid: 0,
  });

  const cancelFlushTimer = useCallback(() => {
    const buf = chunkBufferRef.current;
    if (buf.timer == null) return;
    window.clearTimeout(buf.timer);
    buf.timer = null;
  }, []);

  /**
   * 溜めたぶんを吐き出す。**溜め場を先に空にする**——dispatch の最中に届いた
   * チャンクは次の回のものなので、後から消すと落ちる。
   */
  const flushChunks = useCallback(() => {
    cancelFlushTimer();

    const { pending } = chunkBufferRef.current;
    if (pending.size === 0) return;

    const batches = [...pending];
    pending.clear();

    for (const [requestId, { chunks, files }] of batches) {
      dispatch({ type: "search_chunks", payload: { requestId, chunks, files } });
    }
  }, [cancelFlushTimer]);

  /** 検索が1つ始まったことを溜め場へ知らせる。線を引く位置に要る */
  const noteRequest = useCallback((requestId: RequestId) => {
    const buf = chunkBufferRef.current;
    if (requestId > buf.maxSeenRid) buf.maxSeenRid = requestId;
  }, []);

  const enqueueChunk = useCallback(
    (p: SearchChunkPayload) => {
      const buf = chunkBufferRef.current;
      if (buf.disposed) return;

      noteRequest(p.requestId);
      if (p.requestId <= buf.deadBefore || buf.dead.has(p.requestId)) return;

      const cur = buf.pending.get(p.requestId);
      if (cur) {
        cur.chunks.push(p.chunk);
        for (const f of p.files) cur.files.push(f);
      } else {
        buf.pending.set(p.requestId, { chunks: [p.chunk], files: [...p.files] });
      }

      if (buf.timer == null) buf.timer = window.setTimeout(flushChunks, CHUNK_FLUSH_MS);
    },
    [flushChunks, noteRequest],
  );

  /**
   * 以後この検索のチャンクを受け取らない。溜めたぶんも**吐き出さずに**捨てる。
   * 積んだ先のセッションごと消える場面で使う。
   *
   * `requestId` を省くと「いま在る検索は全部」——`open_start` がそれに当たる。
   */
  const stopAcceptingChunks = useCallback(
    (requestId?: RequestId) => {
      const buf = chunkBufferRef.current;

      if (requestId == null) {
        buf.pending.clear();
        buf.deadBefore = buf.maxSeenRid;
        // 線より手前は `deadBefore` が受け持つので、個別に覚えておく必要は無い
        buf.dead.clear();
      } else {
        buf.pending.delete(requestId);
        if (requestId > buf.deadBefore) buf.dead.add(requestId);
      }

      if (buf.pending.size === 0) cancelFlushTimer();
    },
    [cancelFlushTimer],
  );

  useEffect(() => {
    const buf = chunkBufferRef.current;
    // **setup で開け直す。** 畳んで張り直す経路（StrictMode の二重マウント）で
    // 閉じたままになると、以後のチャンクが1つも積まれない
    buf.disposed = false;

    return () => {
      if (buf.timer != null) window.clearTimeout(buf.timer);
      buf.timer = null;
      buf.pending.clear();
      buf.disposed = true;
    };
  }, []);

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
            noteRequest(p.requestId);
            dispatch({ type: "search_begin", payload: p });
          },
          onSearchChunk: enqueueChunk,

          // **終わりと失敗は、溜めたぶんを吐き出してから。** 先に `isDone` を
          // 立てると、まだ届いていない結果を抱えたまま一覧が「完了」と名乗る。
          // 失敗のときも同じで、届いたぶんは残す
          onSearchEnd: (p: SearchEndPayload) => {
            flushChunks();
            dispatch({ type: "search_end", payload: p });
          },
          onSearchError: (p: SearchErrorPayload) => {
            flushChunks();
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
  }, [enqueueChunk, flushChunks, noteRequest]);

  // --- actions ---
  const openProject = useCallback(
    async (rd: string): Promise<OpenProjectOutput> => {
      if (openInFlightRef.current) return openInFlightRef.current;

      // `open_start` はセッションを全部落とす。**溜めたぶんを捨てるだけでは足りない**
      // ——Rust の `open_project` は進行中の検索をキャンセルしないので、この後も
      // 同じ rid のチャンクが届く。入口ごと閉じないと、消えたはずのセッションが
      // 次の吐き出しで `ensureSession` に作り直される
      stopAcceptingChunks();
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
    [stopAcceptingChunks],
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

      const chunks = session.chunks;
      if (chunks.length === 0) return EMPTY_HITS;

      const cache = hitsCacheRef.current.get(requestId);

      // 前に取り込んだところまでが、いまの並びの先頭とそのまま一致しているか。
      // 一致していれば末尾だけ足せばよい
      const canAppend =
        !!cache &&
        cache.consumed <= chunks.length &&
        (cache.consumed === 0 || chunks[cache.consumed - 1] === cache.lastChunk);

      if (canAppend && cache.consumed === chunks.length) return cache.snapshot;

      const flat = canAppend ? cache.flat : [];
      const start = canAppend ? cache.consumed : 0;
      for (let i = start; i < chunks.length; i++) {
        const chunk = chunks[i];
        for (let j = 0; j < chunk.length; j++) flat.push(chunk[j]);
      }

      // **写しを渡す。** `flat` を直に返すと、増えても同じ配列のままになり、
      // 呼び手の `useMemo` が「変わっていない」と読んで**新着ヒットが一覧に出ない**。
      // いまその形が表に出ていないのは、判定が毎回外れて別の配列を返しているから
      // でしかない。写しは要素の指し直しだけなので、増分追記の意味は消えない
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
    (requestId: RequestId) => {
      // 溜めたぶんも一緒に捨てる。残すと、消したセッションが次の吐き出しで
      // `ensureSession` に作り直される
      stopAcceptingChunks(requestId);
      hitsCacheRef.current.delete(requestId);
      dispatch({ type: "clear_search", payload: { requestId } });
    },
    [stopAcceptingChunks],
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
