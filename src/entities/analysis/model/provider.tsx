import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { AnalysisContextType, PositionSyncAdapter } from "./types";
import { startInfiniteAnalysis as startInfiniteAnalysisCore } from "@/entities/engine/api/tauri";
import { useEngineSeat, type SeatReleasePoint } from "./useEngineSeat";
import { analysisReducer, initialState } from "./reducer";
import { useEngine, type AnalysisResult } from "@/entities/engine";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { setupAnalysisEventListeners } from "@/entities/engine/api/events";
import { AnalysisContext } from "./context";

interface Props {
  children: ReactNode;
  positionSync: PositionSyncAdapter;
}

export function AnalysisProvider({ children, positionSync }: Props) {
  const [state, dispatch] = useReducer(analysisReducer, initialState);

  // Rust の席の生死。**識別子を書き換えられるのはこのフックの中だけ。**
  const seat = useEngineSeat();

  const { isReady } = useEngine();

  const { currentSfen, syncedSfen, syncPosition } = positionSync;

  const unlistenRef = useRef<UnlistenFn | null>(null);

  const syncedSfenRef = useRef<string | null>(syncedSfen);

  // いま盤が見ている局面。**手動開始が待つ相手をここから読む。**
  // 押した瞬間の値に焼き付けると、待っている間に盤が動いたとき、
  // もう誰も見ていない局面の同期を上限いっぱい待って断りを積む。
  const currentSfenRef = useRef<string | null>(currentSfen);
  const analyzingRef = useRef(state.isAnalyzing);

  const latestResultRef = useRef<AnalysisResult | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const RESULT_FLUSH_MS = 80;

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushLatest = useCallback(() => {
    // 解析中じゃないならUI更新しない（stop直後の無駄更新防止）
    if (!analyzingRef.current) return;

    const r = latestResultRef.current;
    if (!r) return;

    dispatch({ type: "update_result", payload: r });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushLatest();
    }, RESULT_FLUSH_MS);
  }, [flushLatest, RESULT_FLUSH_MS]);

  const safeUnlisten = useCallback(() => {
    const fn = unlistenRef.current;
    unlistenRef.current = null;
    if (!fn) return;

    try {
      fn();
    } catch (e) {
      console.debug("[ANALYSIS] unlisten failed (ignored)", e);
    }
  }, []);

  useEffect(() => {
    syncedSfenRef.current = syncedSfen;
  }, [syncedSfen]);

  useEffect(() => {
    currentSfenRef.current = currentSfen;
  }, [currentSfen]);

  useEffect(() => {
    analyzingRef.current = state.isAnalyzing;
  }, [state.isAnalyzing]);

  const lastAnalyzedSfenRef = useRef<string | null>(null);
  const restartInFlightRef = useRef<Promise<void> | null>(null);

  const desiredSfenRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const restartSeqRef = useRef(0);
  // 自動再開の同期待ち。打ち切りの判定に使う。
  // 待っている対象（seq と局面）ごと持つ。時刻だけを持つと、前回の待ちの経過時間を
  // 引き継いで、次の待ちを1ミリ秒も待たずに打ち切ってしまう。
  const syncWaitRef = useRef<{
    seq: number;
    want: string;
    startedAt: number;
  } | null>(null);
  const pendingAfterRef = useRef(false);

  const RESTART_DEBOUNCE_MS = 100;

  // エンジンが position を受け付けるまで待つ上限。これを超えたら送信できていないと
  // 見なし、盤面と一致しない候補手を出さないために解析を始めない。
  // 根拠は実測ではないので、重い評価関数の初期化で足りなければ引き上げてよい。
  const POSITION_SYNC_TIMEOUT_MS = 2000;
  const POSITION_SYNC_TIMEOUT_MESSAGE = "エンジンに現在の局面を送れませんでした";

  // 条件が満たされるまで待つ。**上限か `abort` で抜ける。**
  //
  // `abort` を取るのは、待っている理由が消えたときに回り続けないため。
  // 畳まれた後は `syncedSfen` がもう動かないので、渡さないと必ず上限まで回る。
  const waitUntil = async (cond: () => boolean, timeoutMs: number, abort?: () => boolean) => {
    const start = Date.now();
    while (!cond()) {
      if (abort?.()) return false;
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 16));
    }
    return true;
  };

  // **`window` を通さない。** ここはタイマーのコールバックからも、畳んだ後の
  // 後始末からも呼ばれる。テスト環境は畳んだ後に `window` を落とすので、
  // そこで参照すると**テストが1本も失敗していないのに実行そのものが落ちる**。
  // `clearTimeout` はブラウザにも Node にもある。
  const clearDebounceTimer = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  const unmountedRef = useRef(false);

  // 開始を頼んでから席が返るまでの間に、その要求が要らなくなっていないか。
  //
  // **3つの引き金を同じに扱う**——畳まれた、利用者が止めた（または次の要求が始まった）、
  // 読む局面が無くなった。どれも「返ってきた席の持ち主が居ない」で、
  // 返さなければ Rust に残る。
  // `stopAnalysis` は世代を上げるが、撃てるのはその時点で握っている席まで
  // ——後から返る席を返せるのは、応答が返った側だけ。
  const supersededSince = useCallback(
    (seq: number) => unmountedRef.current || restartSeqRef.current !== seq,
    [],
  );

  // 走っている要求を全部捨てる。**捨てるときの後始末をここにまとめる**
  // （世代・望みの局面・保留・タイマー）。利用者が止めた回と、読む局面が
  // 無くなった回が通る。散らすと、引き金を1つ足すたびにどれを写し忘れたかを
  // 人が数えることになる。
  //
  // **世代だけを上げる口はもう1つある**——局面が変わった回（下の effect）は
  // 次の要求を同時に立てるので、望みの局面を残したままここを通らない。
  // 畳まれた回は `unmountedRef` が同じ役をする。
  const supersedeRequests = useCallback(() => {
    desiredSfenRef.current = null;
    pendingAfterRef.current = false;
    restartSeqRef.current++;
    clearDebounceTimer();
  }, []);

  // 返ってきた席を握るか捨てるか。**欄に入れる前に見る**——要らなくなった席を
  // 欄に入れると、その後に入った別の席を上書きして、走っている方を知る者が居なくなる。
  // 捨てた側は `false` を返すので、呼び手はそこで打ち切る。
  const holdUnlessSuperseded = useCallback(
    (seq: number, at: SeatReleasePoint, sessionId: string) => {
      if (supersededSince(seq)) {
        seat.discard(at, sessionId);
        return false;
      }
      seat.hold(sessionId);
      return true;
    },
    [seat, supersededSince],
  );

  // 畳まれたときに、この画面が残していくものを断つ。**2つある。**
  //
  // - 再開のタイマー。局面を見る effect の cleanup だけでは足りない——早期 return を
  //   踏んだ回は cleanup を登録しないので、その回に張られた分を止める者が残らない。
  //   残ると、居ない画面のためにエンジンへ go を出し、window の消えたテスト環境では
  //   タイマー自身が投げる
  // - Rust の席。→ `seat.sweepOnUnmount()`（`useEngineSeat.ts`）
  useEffect(() => {
    // **setup で戻す。** cleanup で落とすだけだと、同じインスタンスに
    // setup → cleanup → setup が走ったとき（StrictMode）に true のまま残り、
    // 以降タイマーが1つも張られず、盤を進めても解析が黙って再開しなくなる。
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      clearDebounceTimer();
      seat.sweepOnUnmount();
    };
    // `seat` は同じ物が返り続ける（`useEngineSeat`）。載せても再実行されない。
  }, [seat]);

  // === Event listeners ===
  useEffect(() => {
    let alive = true;

    const setup = async () => {
      safeUnlisten();

      if (!isTauri()) return;

      try {
        const unlisten = await setupAnalysisEventListeners({
          onUpdate: (sessionId: string, result: AnalysisResult) => {
            // **自分のセッションのものだけ採る。** 前の探索が畳まりきる前に
            // 次の `go` が出ると、古い局面の `info` がこちらへ配られる。
            // 採ると、前の局面の評価値と読み筋が現在の盤面の解析結果として出る。
            //
            // 照らすのは `state` の写しではなく席の欄。写しが更新されるのは
            // commit の後なので、**探索を始めた直後のいちばん出したい `info`** が
            // 「自分のじゃない」と落ちる。
            if (!seat.matches(sessionId)) return;
            latestResultRef.current = result;
            scheduleFlush();
          },
          // **この通知は現物では届かない。** `analysis-complete` を emit する行が
          // Rust に無い（`docs/state-transitions/analysis.md` の E8 / ※6）。
          // 口が入ったときの取り決めとして置いてある。
          onComplete: (sessionId: string, result: AnalysisResult) => {
            // 終わった探索の席は Rust が自分で片付ける（`bridge.rs` の
            // `forward_results_to_ui`）。**握っている席と一致するときだけ手放す。**
            // 一致しないまま手放すと、走っている別の席を知る者が居なくなる。
            // 一致しない側に倒したときの損は、畳んだときに空振りの停止が1本出るだけ。
            seat.forget(sessionId);

            latestResultRef.current = result;
            clearFlushTimer();
            flushLatest();
            dispatch({ type: "stop_analysis" });
          },
          // **この通知も届かない**（`engine-error` を emit する行が無い。E9 / ※6）。
          onError: (error: string) => {
            dispatch({ type: "set_error", payload: error });
          },
        });

        if (!alive) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
      } catch (e) {
        console.error("[ANALYSIS] Failed to setup listeners:", e);
      }
    };

    setup();

    return () => {
      alive = false;
      clearFlushTimer();
      safeUnlisten();
    };
  }, [safeUnlisten, scheduleFlush, clearFlushTimer, flushLatest, seat]);

  const runRestartRef = useRef<(seq: number) => void>(() => {});

  // 再開のタイマーを張る口をここ1つにする。畳まれた後に張ると、それを止める
  // cleanup はもう走らない。非同期の再開が返ってきた後の張り直しは、まさにそこを通る。
  const scheduleRestart = useCallback((seq: number, delayMs: number) => {
    if (unmountedRef.current) return;
    debounceTimerRef.current = window.setTimeout(() => {
      runRestartRef.current(seq);
    }, delayMs);
  }, []);

  // 自動再開の本体。**`scheduleRestart` が張ったタイマーからだけ呼ばれる。**
  //
  // やることは3つ。エンジンが望みの局面に追いつくのを待つ（追いつかなければ打ち切る）、
  // 古い席を返して新しい席を取る、その席が要らなくなっていないかを見る。
  //
  // `seq` は要求の世代。**タイマーが起きた時点と、await から戻った時点の両方で見る。**
  // 見ないと、利用者が止めた後や次の要求が始まった後に go を出す。
  runRestartRef.current = (seq: number) => {
    // **畳まれていたら何もしない。** 張る側（`scheduleRestart`）は見ているが、
    // 張った後に畳まれた回はここへ来る。
    if (unmountedRef.current) return;
    if (restartSeqRef.current !== seq) return;
    if (!analyzingRef.current) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (syncedSfen !== want) {
      // 同期を待つ。手動開始と同じ上限で打ち切る。上限が無いと、同期が恒久的に
      // 失敗したときに「解析中」の表示のままタイマーだけが回り続け、
      // 利用者には何も起きていないのに正常に見える。
      const prev = syncWaitRef.current;
      const startedAt =
        prev && prev.seq === seq && prev.want === want ? prev.startedAt : Date.now();
      syncWaitRef.current = { seq, want, startedAt };

      if (Date.now() - startedAt > POSITION_SYNC_TIMEOUT_MS) {
        syncWaitRef.current = null;
        clearDebounceTimer();

        // エンジン側のセッションも必ず止める。React の state だけ落とすと
        // Rust には席が残り、以降 start_infinite_analysis が
        // 常に「Analysis already running」で弾かれて解析を再開できなくなる。
        // エンジン側の席も返す。握っていなければ何もしない。
        // 落ちたときに何が残るかは `useEngineSeat` の `releaseHeldQuietly` にある。
        seat.releaseHeldQuietly("sync-timeout");

        dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
        dispatch({ type: "stop_analysis" });
        return;
      }

      clearDebounceTimer();
      scheduleRestart(seq, 16);
      return;
    }

    syncWaitRef.current = null;

    if (restartInFlightRef.current) {
      pendingAfterRef.current = true;
      return;
    }

    restartInFlightRef.current = (async () => {
      try {
        await seat.releaseHeld("restart");

        // 停止の応答を待っている間に、畳まれたり止められたりしている。
        // ここで go を出すと、誰も見ていない探索が走り、それを止める者もいない。
        //
        // **画面に触るのは門の後ろ。** `clear_results` は `error` も消すので
        // （`reducer.ts`）、要らなくなった要求がここを通ると、直前に立った
        // 打ち切りの `error` が黙って消える（その `error` の読み手はまだ0 → #277）。
        if (supersededSince(seq)) return;

        clearFlushTimer();
        latestResultRef.current = null;
        dispatch({ type: "clear_results" });

        const newSessionId = await startInfiniteAnalysisCore();
        if (!holdUnlessSuperseded(seq, "late-restart", newSessionId)) return;

        dispatch({ type: "start_analysis", payload: { position: want } });

        lastAnalyzedSfenRef.current = want;
      } catch (e) {
        // 要らなくなった要求の失敗は、誰にも見せない。利用者が止めた後に
        // 「再開に失敗しました」が出るし、`stop_analysis` の dispatch は
        // 別の理由で走り出した解析を巻き添えにする。
        if (supersededSince(seq)) return;

        dispatch({
          type: "set_error",
          payload: `Failed to restart analysis: ${e instanceof Error ? e.message : String(e)}`,
        });
        dispatch({ type: "stop_analysis" });
        lastAnalyzedSfenRef.current = null;
      } finally {
        restartInFlightRef.current = null;

        if (pendingAfterRef.current) {
          pendingAfterRef.current = false;
          const latestSeq = restartSeqRef.current;
          clearDebounceTimer();
          scheduleRestart(latestSeq, 0);
        }
      }
    })();
  };

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;
    if (!currentSfen) return;
    if (lastAnalyzedSfenRef.current === currentSfen) return;

    desiredSfenRef.current = currentSfen;

    clearDebounceTimer();
    const seq = ++restartSeqRef.current;

    scheduleRestart(seq, RESTART_DEBOUNCE_MS);

    return () => {
      clearDebounceTimer();
    };
  }, [currentSfen, state.isAnalyzing, isReady, scheduleRestart]);

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    if (syncedSfen !== want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (!debounceTimerRef.current && !restartInFlightRef.current) {
      scheduleRestart(restartSeqRef.current, 0);
    }
  }, [syncedSfen, state.isAnalyzing, isReady, scheduleRestart]);

  // **読む局面が無くなったら止める。** 棋譜を閉じると `currentSfen` が null になるが、
  // 解析ペインごと畳まれるわけではない（`AnalysisProvider` は `RuntimeProviders` 側に居る）。
  // 自動再開は `if (!currentSfen) return` で黙って止まるだけなので、放っておくと
  // エンジンは閉じた棋譜の局面を読み続け、**それを止めるボタンは画面から消えている**。
  useEffect(() => {
    if (currentSfen) return;

    // **世代は先に上げる。** 飛んでいる開始（席が返るまで `isAnalyzing` は false）を
    // 打ち切るのはこの1行で、下の門より後ろに置くと、閉じた棋譜のために
    // 同期待ちが上限まで回り、閉じた局面で「解析中」が1回 commit される。
    supersedeRequests();

    // **席を握っていれば、表示が停止中でも返す。** 停止が届かなかった回は
    // `isAnalyzing` が false のまま席だけ残る（→ ※7）。`state` の写しで
    // 決めると、その回にエンジンが閉じた棋譜を読み続ける。
    if (!state.isAnalyzing && !seat.isHeld()) return;

    seat.releaseHeldQuietly("no-position");
    dispatch({ type: "stop_analysis" });
  }, [currentSfen, state.isAnalyzing, seat, supersedeRequests]);

  const startInFlightRef = useRef<Promise<void> | null>(null);

  const startInfiniteAnalysis = useCallback(async () => {
    if (!isReady) throw new Error("Engine not ready");
    if (state.isAnalyzing) return;
    if (!currentSfen) throw new Error("No position available for analysis");

    // **席を握ったままなら先に返す。** 停止が届かなかった回はこの形になり、
    // `isAnalyzing` が false なので ■ は出ていない。返さずに開始を頼むと
    // Rust に断られ続け、画面からは復帰できなくなる（→ #172）。
    // 押してから席が返るまでの世代。**返却より前に読む**——`releaseHeld` は
    // 本物の往復を挟むので、その間に世代が上がる（棋譜を閉じた回）と、
    // 後で読むと上がった後の値を持ってしまい、以降の門が1枚も効かない。
    //
    // この窓でボタンから動く口は無い（席が返るまでヘッダは ▶ のまま）。
    // 動くのは畳まれた回と、読む局面が無くなった回。
    const seq = restartSeqRef.current;

    // 握っていなければ `releaseHeld` は何もしない。
    await seat.releaseHeld("start");
    if (supersededSince(seq)) return;

    await syncPosition();

    // 送れていないまま解析を始めると、エンジンには別の局面が入ったまま
    // 候補手が返ってきて、盤面と一致しないものが表示される。
    //
    // **待つ相手は「いま盤が見ている局面」。** 押した瞬間の値を待つと、
    // 待っている間に盤が動いた回は条件が二度と真にならず、上限いっぱい回してから
    // 何も失敗していないのに断りを積む（同期は新しい局面へ追いついている）。
    //
    // **要らなくなったら待つのをやめる**（畳まれた／止められた／読む局面が無くなった）。
    // 待ち続けても `syncedSfen` はもう動かないので、上限いっぱい回るだけになる。
    const synced = await waitUntil(
      () => currentSfenRef.current !== null && syncedSfenRef.current === currentSfenRef.current,
      POSITION_SYNC_TIMEOUT_MS,
      () => supersededSince(seq),
    );
    if (!synced) {
      // 要らなくなった要求の失敗は誰にも見せない（再開側の `catch` と同じ）。
      if (supersededSince(seq)) return;

      dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
      throw new Error(POSITION_SYNC_TIMEOUT_MESSAGE);
    }

    // **go を出す前にも見る。** 再開側と同じ形（`runRestartRef` の中）。
    // ここを抜かすと、止めた後・畳まれた後にエンジンへ `go` を出してから、
    // 返ってきた席を返す——誰も見ていない探索が1往復ぶん走る。
    if (supersededSince(seq)) return;

    // 待ち切った局面で始める。押した瞬間の局面とは違うことがある。
    const started = currentSfenRef.current;
    if (!started) return;

    const sessionId = await startInfiniteAnalysisCore();
    if (!holdUnlessSuperseded(seq, "late-start", sessionId)) return;

    dispatch({ type: "start_analysis", payload: { position: started } });

    lastAnalyzedSfenRef.current = started;
    desiredSfenRef.current = started;
  }, [
    isReady,
    state.isAnalyzing,
    currentSfen,
    syncPosition,
    seat,
    supersededSince,
    holdUnlessSuperseded,
  ]);

  // **押している間に押し直されても1本にする。** `isAnalyzing` が立つのは
  // 局面を送って席が返った後（最大2秒）で、その間ボタンは ▶ のまま押せる。
  // 2本目は Rust の `take_session` に断られ、その断りは `console.error` で終わる
  // ——利用者には何も出ない。
  //
  // **`finally` で必ず外す。** 外し忘れると、以降 ▶ が「走っている」と
  // 見なされて二度と始まらない。
  const startInfiniteAnalysisOnce = useCallback(async () => {
    const running = startInFlightRef.current;
    if (running) return running;

    const started = startInfiniteAnalysis().finally(() => {
      startInFlightRef.current = null;
    });
    startInFlightRef.current = started;
    return started;
  }, [startInfiniteAnalysis]);

  const stopAnalysis = useCallback(async () => {
    supersedeRequests();

    // 席を握っていなければ `releaseHeld` は何もしない。**席の判定はフックの中に1つだけ。**
    try {
      await seat.releaseHeld("stop");
    } finally {
      dispatch({ type: "stop_analysis" });
      clearFlushTimer();
      latestResultRef.current = null;
    }
  }, [clearFlushTimer, seat, supersedeRequests]);

  const value = useMemo<AnalysisContextType>(
    () => ({
      state,
      startInfiniteAnalysis: startInfiniteAnalysisOnce,
      stopAnalysis,
    }),
    [state, startInfiniteAnalysisOnce, stopAnalysis],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
