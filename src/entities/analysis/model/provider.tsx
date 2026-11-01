import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { AnalysisContextType, PositionSyncAdapter } from "./types";
import {
  isAnalysisStartUnreachable,
  startInfiniteAnalysis as startInfiniteAnalysisCore,
  type AnalysisSessionId,
  type DiscardReleasePoint,
  type StopOutcome,
} from "../api/tauri";
import { useEngineSeat, type SeatTakeResult } from "./useEngineSeat";
import { useResultFlush } from "./useResultFlush";
import { waits } from "./waits";
import { analysisReducer, initialState } from "./reducer";
import {
  useEngine,
  type AnalysisResult,
  type EngineNotReadyReason,
  type EngineReadiness,
} from "@/entities/engine";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { setupAnalysisEventListeners } from "../api/events";
import { createCandidateCache, type CandidateCache } from "../lib/candidateCache";
import { AnalysisContext } from "./context";
import {
  LISTENERS_FAILED_MESSAGE,
  NOT_READY_REFUSALS,
  POSITION_SYNC_TIMEOUT_MESSAGE,
  RESTART_FAILED_MESSAGE,
  START_REFUSED_MESSAGE,
} from "./refusals";

type Props = {
  children: ReactNode;
  positionSync: PositionSyncAdapter;
};

/**
 * `cond` が真になるまで待ち、真なら `true`、上限か `abort` で抜けたら `false` を返す。
 *
 * `abort` は待つ理由が消えたときに抜けるために取る。アンマウント後は `syncedSfen` がもう動かないので、
 * 渡さないと必ず上限まで回る。
 */
const waitUntil = async (cond: () => boolean, timeoutMs: number, abort?: () => boolean) => {
  const start = Date.now();

  // 盤が同期済みなら条件は既に真でループへ入らない。ループの中だけで見ると `abort` が評価されず、
  // 往復の最中にエンジンが消えてもそのまま席を取りに行く。
  if (abort?.()) return false;

  while (!cond()) {
    if (abort?.()) return false;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, waits().syncPollMs));
  }
  return true;
};

/**
 * 検討の意思を残してエンジンが戻るのを待つ理由か。断らず語で言う。
 */
const holdsIntentWhile = (reason: EngineNotReadyReason) =>
  reason === "starting" || reason === "failed";

/**
 * 解析の状態を子へ渡し、Rust の席の生死を持つ。
 *
 * 呼び手が守ることは2つある。
 *
 * - 棋譜の有無でアンマウントされない位置に置く（`RuntimeProviders`）。棋譜を閉じるたびにアンマウント
 *   すると、席を指して返す機会が無くなり、`sweepOnUnmount` の席を指さない停止が別の経路の席まで空ける
 * - `positionSync` にはアプリ全体で1箇所だけがマウントした `useEnginePositionSync` を渡す。
 *   同期の状態が二重になると待つ相手が食い違う
 *
 * 遷移の表は `docs/state-transitions/analysis.md`。コメントの ※ はその表の注を指す。
 */
export function AnalysisProvider({ children, positionSync }: Props) {
  const [state, dispatch] = useReducer(analysisReducer, initialState);

  const seat = useEngineSeat();

  const readiness = useEngine();
  const { isReady, notReadyReason, reportUnreachable } = readiness;

  const { currentSfen, syncedSfen, syncPosition } = positionSync;

  const unlistenRef = useRef<UnlistenFn | null>(null);

  /**
   * 最後に届いた完了の結果。開始の応答より先に完了が届いたとき、応答の側が読む。
   * ▶ の経路はその時点で `isAnalyzing` が立っておらず、reducer が完了を捨てるため。
   */
  const finishedResultRef = useRef<AnalysisResult | null>(null);

  /** 結果の購読に失敗した。張り直す経路はマウント時の1回だけなので、以後の ▶ は断りを立て直して降りる */
  const listenersFailedRef = useRef(false);

  /**
   * await の向こう側でエンジンが消えたかを見るための写し。
   *
   * 合併のまま1本で持つ。2つの ref に割ると tsc の narrowing が消え、読む側が既定値を書くことになる。
   */
  const readinessRef = useRef<EngineReadiness>(readiness);

  // `useMemo` は覚えた値を捨てうる。捨てられると控えが空に戻り、読み手より長生きするという
  // 置き場の目的（`lib/candidateCache.ts`）が崩れる。
  const candidateCacheRef = useRef<CandidateCache | null>(null);
  candidateCacheRef.current ??= createCandidateCache();
  const candidateCache = candidateCacheRef.current;

  const syncedSfenRef = useRef<string | null>(syncedSfen);

  // ▶ が待つ相手。押した瞬間の値に固定すると、待っている間に盤が動いたとき、
  // 誰も見ていない局面の同期を上限まで待って断りを立てる。
  const currentSfenRef = useRef<string | null>(currentSfen);
  const analyzingRef = useRef(state.isAnalyzing);

  const results = useResultFlush(dispatch, analyzingRef, seat.isHeld);

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

  useEffect(() => {
    readinessRef.current = readiness;
  }, [readiness]);

  /**
   * エンジンへ送り済みの局面。自動再開を抑止する印で、`null` はもう一度送ってよいことを表す。
   * 画面が読む `state.analyzedSfen` とは別に動く。
   */
  const sentSfenRef = useRef<string | null>(null);
  const restartInFlightRef = useRef<Promise<void> | null>(null);

  const desiredSfenRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const restartSeqRef = useRef(0);
  // 自動再開の同期待ちの開始。時刻だけを持つと前回の経過を引き継ぎ、次の待ちをすぐ打ち切るので、
  // 待つ相手（`seq` と局面）ごと持つ。
  const syncWaitRef = useRef<{
    seq: number;
    want: string;
    startedAt: number;
  } | null>(null);
  const pendingAfterRef = useRef(false);

  // `window` を通さない。アンマウント後の後始末からも呼ばれ、テスト環境はその時点で `window` を
  // 落とすので、参照するとテストが通っていても実行そのものが落ちる。
  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const unmountedRef = useRef(false);

  /**
   * 再開のタイマーが張られているか。発火で `scheduleRestart` が欄を空けるので、
   * `true` はまだ起きていないタイマーがあるときだけ。
   */
  const isRestartScheduled = useCallback(() => debounceTimerRef.current !== null, []);

  /**
   * 応答待ちの再開があれば予約して `true` を返す。2本目を重ねないための判定。
   *
   * 予約は `swapSeatAndGo` の `finally` が拾う。予約しないと、エンジンが2回続けて落ちたときに
   * 再開の引き金が消える。
   */
  const bookIfRestarting = useCallback(() => {
    if (!restartInFlightRef.current) return false;
    pendingAfterRef.current = true;
    return true;
  }, []);

  // 開始を頼んでから席が返るまでの間に、要求が要らなくなったかを返す。引き金はアンマウント、
  // 利用者の停止か次の要求、読む局面の消失で、どれも返ってきた席の持ち主が居なくなる。
  // `stopAnalysis` が返せるのはその時点で握っている席までで、後から返る席は応答の側でしか返せない。
  const supersededSince = useCallback(
    (seq: number) => unmountedRef.current || restartSeqRef.current !== seq,
    [],
  );

  // 走っている要求を全部捨てる（世代、望みの局面、保留、タイマー）。局面が変わったときの effect は
  // 次の要求を同時に立てるので世代だけを上げ、アンマウントでは `unmountedRef` が同じ役をする。
  const supersedeRequests = useCallback(() => {
    desiredSfenRef.current = null;
    pendingAfterRef.current = false;
    restartSeqRef.current++;
    clearDebounceTimer();
  }, [clearDebounceTimer]);

  /**
   * 握れなかった席の反映待ちを捨てる。`clear_results` は `error` も消すので使わない。
   *
   * 主の保証は `commitLatest` の席の判定で、ここは次に席を握るまで残る古い1本を落とす。
   * 呼び手は握れなかった経路だけで、どれも先に席を返し終えている。
   *
   * **席を見て降りる形にしない。** 捨てる停止が落ちると `keepOrForget` が席を欄へ書き戻すので、
   * 席を見ると反映待ちが残り、席の判定も通って捨てた席の読み筋が出る。
   * テストは「捨てる停止が落ちて席が欄へ戻っても、その席の結果は出さない」。
   */
  const dropPendingForLostSeat = useCallback(() => {
    results.dropPending();
  }, [results]);

  /**
   * 席を取って `go` を出し、握るまでを進め、結末を返す。▶ と自動再開の両方が通る。
   *
   * 開始の失敗は呼び手へ投げる。断りの文は経路ごとに違う。
   *
   * **呼ぶ前に `supersededSince` を通すこと。** 本体の先頭の `clear_results` は `error` も消すので、
   * 要らなくなった要求が入ると直前に立った断りが黙って消える。
   */
  const takeSeatAndGo = useCallback(
    async (seq: number, want: string, discardBy: DiscardReleasePoint): Promise<SeatTakeResult> => {
      results.discardShown();

      const take = seat.beginTake(discardBy, () => readinessRef.current.isReady);

      // 席が返って捨てるときも断られるときも、握れなければ反映待ちを落とす。
      let taken: SeatTakeResult;
      try {
        const sessionId = await startInfiniteAnalysisCore();
        taken = take.receiveSeat(sessionId, () => supersededSince(seq));
      } catch (e) {
        // 起動し直している最中のエンジンへの開始は Rust が `Err` で返す（`bridge.rs`）。
        // 分けないと、利用者が起動し直した直後に「再起動してください」と案内する。
        // 判定は `receiveSeat` と同じ条件にするため `hasEngineChanged` に任せる。
        if (!isAnalysisStartUnreachable(e) && !take.hasEngineChanged()) throw e;

        // ここで降りると例外にならず、呼び手の `console.error` に届かないので Rust の文を残す。
        console.warn("[ANALYSIS] start refused while the engine was away", e);

        // エンジンへ書けなかったときは語が言う。断りを立てず、検討の意思も切らない。
        if (isAnalysisStartUnreachable(e)) {
          if (!take.hasEngineChanged()) reportUnreachable();
          dropPendingForLostSeat();
          return "engine-gone";
        }
        taken = "engine-gone";
      }

      if (taken !== "held" && taken !== "finished") {
        dropPendingForLostSeat();
        return taken;
      }

      dispatch({ type: "start_analysis", payload: { sfen: want } });
      sentSfenRef.current = want;

      if (taken === "finished") {
        results.dropPending();
        const finished = finishedResultRef.current;
        if (finished) dispatch({ type: "finish_analysis", payload: finished });
        return taken;
      }

      results.schedule();
      return taken;
    },
    [results, dropPendingForLostSeat, reportUnreachable, seat, supersededSince],
  );

  // アンマウントで再開のタイマーと Rust の席を片付ける。局面を見る effect は早期 return の描画で
  // cleanup を登録しないので、そのタイマーはここで消す。
  useEffect(() => {
    // cleanup で立てる印は setup で戻す。StrictMode の setup → cleanup → setup で true のまま残ると、
    // タイマーが1つも張られず、盤を進めても解析が黙って再開しなくなる。
    unmountedRef.current = false;
    seat.markMounted();

    return () => {
      unmountedRef.current = true;
      clearDebounceTimer();
      seat.sweepOnUnmount();
    };
  }, [seat, clearDebounceTimer]);

  useEffect(() => {
    let alive = true;

    const setup = async () => {
      safeUnlisten();

      if (!isTauri()) return;

      try {
        const unlisten = await setupAnalysisEventListeners({
          onUpdate: (sessionId: AnalysisSessionId, result: AnalysisResult) => {
            if (!seat.accepts(sessionId)) return;
            results.receive(result);
          },
          onComplete: (sessionId: AnalysisSessionId, result: AnalysisResult) => {
            // 通さないと、古い席の完了通知で走っている検討が終わったことになる。
            if (!seat.accepts(sessionId)) return;

            // 終わった探索の席は Rust が消し終えている（`forward_results_to_ui`）。
            seat.closeFinished(sessionId);

            finishedResultRef.current = result;
            results.dropPending();
            dispatch({ type: "finish_analysis", payload: result });
          },
        });

        if (!alive) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
        // StrictMode の setup → cleanup → setup で印を戻す。戻さないと、1度の失敗が以後の ▶ を断り続ける。
        listenersFailedRef.current = false;
      } catch (e) {
        // アンマウント済みの setup の失敗で、生きているインスタンスの印と `state.error` を汚さない。
        if (!alive) return;

        // この effect はマウント1回きりで、落ちると結果が二度と届かない。断りだけでは ▶ の
        // `clear_results` に消されて `go` が出るので、印を残して以後の ▶ を断る。
        console.error("[ANALYSIS] Failed to setup listeners:", e);
        listenersFailedRef.current = true;
        dispatch({ type: "set_error", payload: LISTENERS_FAILED_MESSAGE });
      }
    };

    setup();

    return () => {
      alive = false;
      results.dropPending();
      safeUnlisten();
    };
  }, [safeUnlisten, results, seat]);

  /** エンジンが `generation` のままなら `応答なし` を報告する。替わっていれば前のエンジンの失敗 */
  const reportUnreachableSince = useCallback(
    (generation: number) => {
      if (seat.engineGeneration() === generation) reportUnreachable();
    },
    [reportUnreachable, seat],
  );

  const runRestartRef = useRef<(seq: number) => void>(() => {});

  // 再開のタイマーを張る。アンマウント後に張ると止める cleanup が無いので、ここで見る。
  const scheduleRestart = useCallback(
    (seq: number, delayMs: number) => {
      if (unmountedRef.current) return;

      // 張る前に消し、本体を起こすタイマーを1本に保つ。
      clearDebounceTimer();

      debounceTimerRef.current = window.setTimeout(() => {
        // 空けないと `isRestartScheduled` が発火済みの id を見て、盤が追いついても再開を張らない。
        debounceTimerRef.current = null;
        runRestartRef.current(seq);
      }, delayMs);
    },
    [clearDebounceTimer],
  );

  /**
   * エンジンが局面に追いつくのをタイマーで待ち、上限を越えたら席を返して断る。
   *
   * 上限が無いと、同期が失敗し続けても `検討中` のままタイマーだけが回り、正常に見える。
   *
   * **打ち切りの条件を変えるときは `sendAndAwaitSync` も見ること。** ▶ は同じ上限を `waitUntil` で待つ。
   */
  const keepWaitingForSync = useCallback(
    (seq: number, want: string) => {
      const prev = syncWaitRef.current;
      const startedAt =
        prev && prev.seq === seq && prev.want === want ? prev.startedAt : Date.now();
      syncWaitRef.current = { seq, want, startedAt };

      if (Date.now() - startedAt > waits().positionSyncTimeoutMs) {
        syncWaitRef.current = null;
        clearDebounceTimer();

        seat.releaseHeldQuietly("sync-timeout");

        dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
        dispatch({ type: "stop_analysis" });
        return;
      }

      scheduleRestart(seq, waits().syncPollMs);
    },
    [clearDebounceTimer, scheduleRestart, seat],
  );

  /**
   * 同期が追いついた局面へ、古い席を返して新しい席を取り直す。
   *
   * `seq` は要求の世代で、await から戻るたびに見直す。返却の往復の間に止められることがある。
   * 応答待ちの間に来た要求は `finally` が拾う。返す Promise を `restartInFlightRef` に載せるのは呼び手。
   */
  const swapSeatAndGo = useCallback(
    async (seq: number, want: string) => {
      try {
        // 届かなかったときも検討は切らない。`応答なし` から再起動すれば同じ局面を読む
        const generation = seat.engineGeneration();
        let released: StopOutcome;
        try {
          released = await seat.releaseHeld("restart");
        } catch (e) {
          if (supersededSince(seq)) return;
          console.error("[ANALYSIS] could not stop the search before moving on", e);
          reportUnreachableSince(generation);
          sentSfenRef.current = null;
          return;
        }
        // 読み直しの印を捨て、遅らせて張り直す。上限の直後に答えが来ると知らせが1回の描画にまとまり、
        // `isReady` が動かないので、同期の追従の effect が走らない。まだ答えていなければ
        // `runRestartRef` の `isReady` の判定で降りる。
        if (released === "unanswered") {
          sentSfenRef.current = null;
          scheduleRestart(restartSeqRef.current, waits().restartDebounceMs);
          return;
        }

        // 応答待ちの間に要らなくなっていたら `go` を出さない。誰も見ていない探索が走り、止める者も居ない。
        if (supersededSince(seq)) return;

        // 押した人が居ない。エンジンが消えたなら戻れば同期の追従が張り直す（※13）。
        await takeSeatAndGo(seq, want, "late-restart"); // async-result-ignored: 自動再開は黙って降りる
      } catch (e) {
        // 要らなくなった要求の失敗は見せない。`stop_analysis` は別の理由で走り出した解析を巻き添えにする。
        if (supersededSince(seq)) return;

        // `e` は Rust の英文で、`state.error` は画面へ出す欄なのでそのまま載せない。
        console.error("[ANALYSIS] restart failed", e);
        dispatch({ type: "set_error", payload: RESTART_FAILED_MESSAGE });
        dispatch({ type: "stop_analysis" });
        sentSfenRef.current = null;
      } finally {
        restartInFlightRef.current = null;

        if (pendingAfterRef.current) {
          pendingAfterRef.current = false;
          const latestSeq = restartSeqRef.current;
          scheduleRestart(latestSeq, 0);
        }
      }
    },
    [reportUnreachableSince, scheduleRestart, seat, supersededSince, takeSeatAndGo],
  );

  // 自動再開の本体。追いつくのを待つか席を取り直すかを選ぶ。`scheduleRestart` のタイマーだけが呼ぶ。
  //
  // 描画のたびに差し替える。タイマーが運ぶのは `seq` だけで、最新の `syncedSfen` と `isReady` は
  // この再代入が運ぶ。`useCallback` に包むと描画の値で固定され、effect へ移すと1描画ぶん遅れる。
  runRestartRef.current = (seq: number) => {
    if (supersededSince(seq)) return;
    if (!analyzingRef.current) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;
    if (sentSfenRef.current === want) return;

    if (syncedSfen !== want) {
      keepWaitingForSync(seq, want);
      return;
    }

    syncWaitRef.current = null;

    if (bookIfRestarting()) return;

    restartInFlightRef.current = swapSeatAndGo(seq, want);
  };

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;
    if (!currentSfen) return;

    // 下の判定より前に書く。後ろに置くと、盤を1手進めてすぐ戻したときに前の局面が欄に残り、
    // 盤と違う局面へ `go` を出すか、追いつかない局面を上限まで待って断りを立てる。
    desiredSfenRef.current = currentSfen;

    // `state` で判定する。ref で書くとその ref が動いても effect が再実行されず、
    // 盤と読んでいる局面の食い違いを誰も拾わない。
    if (state.analyzedSfen === currentSfen) return;

    const seq = ++restartSeqRef.current;

    scheduleRestart(seq, waits().restartDebounceMs);

    return () => {
      clearDebounceTimer();
    };
  }, [
    currentSfen,
    state.isAnalyzing,
    state.analyzedSfen,
    isReady,
    scheduleRestart,
    clearDebounceTimer,
  ]);

  // エンジンが使えなくなったら送り済みの印と席の欄を捨てる。起動し直しで Rust の席は全部空くので、
  // 欄に残るのはもう無い席。捨てないと、戻ったときに下の effect が送り済みと読んで降り、
  // `検討中` のまま数字が動かない。
  const engineWasGoneRef = useRef(false);
  useEffect(() => {
    if (isReady) {
      if (engineWasGoneRef.current) dispatch({ type: "engine_restored" });
      engineWasGoneRef.current = false;
      return;
    }
    engineWasGoneRef.current = true;

    sentSfenRef.current = null;
    clearDebounceTimer();
    seat.onEngineGone();
  }, [isReady, seat, clearDebounceTimer]);

  // 同期が追いついたときと、エンジンが戻ったときに再開を張る。局面を見る effect は `syncedSfen` を
  // 依存に持たないので、送信が遅れて追いついたときを拾えない。
  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    if (syncedSfen !== want) return;
    if (sentSfenRef.current === want) return;

    if (bookIfRestarting()) return;

    if (isRestartScheduled()) return;

    scheduleRestart(restartSeqRef.current, 0);
  }, [
    syncedSfen,
    state.isAnalyzing,
    isReady,
    scheduleRestart,
    bookIfRestarting,
    isRestartScheduled,
  ]);

  // 選択が外れたときと起動を中止したときは検討の意思を下ろす。利用者がエンジンから離れたので、
  // 次に動いたエンジンに読ませない。
  useEffect(() => {
    if (notReadyReason !== "no-engine" && notReadyReason !== "cancelled") return;
    if (!state.isAnalyzing) return;

    supersedeRequests();
    dispatch({ type: "stop_analysis" });
  }, [notReadyReason, state.isAnalyzing, supersedeRequests]);

  // 読む局面が無くなったら止める。棋譜を閉じると `AnalysisPane` ごと ▶ と ■ が消えるが、provider は
  // 残るので、放っておくとエンジンは閉じた棋譜を読み続け、止めるボタンも無い（※14）。
  useEffect(() => {
    if (currentSfen) return;

    // 下の判定より先に世代を上げる。応答待ちの開始は `isAnalyzing` が false なので、後ろに置くと
    // 閉じた棋譜のために同期待ちが上限まで回る。
    supersedeRequests();

    // 同期の打ち切りの返却が落ちると、`isAnalyzing` が false のまま席だけ残るので、席も見る。
    if (!state.isAnalyzing && !seat.isHeld()) return;

    seat.releaseHeldQuietly("no-position");
    dispatch({ type: "stop_analysis" });
    // 解析中に閉じると `isAnalyzing` が倒れてこの effect が2回走る。2本目は1本目の後ろに並び、
    // 席を返せていれば送らない。
  }, [currentSfen, state.isAnalyzing, seat, supersedeRequests]);

  const startInFlightRef = useRef<Promise<void> | null>(null);

  /**
   * 断りを立てて投げる。▶ の経路で断るときはどの段もここを通る。
   * 例外は読む局面が無いときで、`refuseIfCannotStart` が断りを立てずに投げる。
   */
  const failStart = useCallback((message: string, e: unknown): never => {
    dispatch({ type: "set_error", payload: message });
    throw e;
  }, []);

  /**
   * エンジンへ届かなかったとして、語を `応答なし` にして投げる。
   * ▶ の押し直しは `応答なし` では効かず案内する文が無いので、断りは立てない。
   */
  const failUnreachable = useCallback(
    (e: unknown, generation: number): never => {
      // 押した意思は残す。どの段で書けなかったかで、再起動の後に読むかが割れないように
      dispatch({ type: "hold_intent" });
      reportUnreachableSince(generation);
      throw e;
    },
    [reportUnreachableSince],
  );

  /**
   * ▶ がいま `go` を出せるかを返す。エンジンの起動を待っているなら断らず `false`、
   * 押しても結果が届かないと分かっていれば断りを立てて投げる。
   *
   * どの判定も席に触る前に通るので、断っても Rust の状態は動かない。
   */
  const refuseIfCannotStart = useCallback(() => {
    // 結果を受け取れないなら `go` を出さない。候補手は届かず Rust の席だけが埋まる。
    if (listenersFailedRef.current) {
      failStart(LISTENERS_FAILED_MESSAGE, new Error("Analysis event listeners are not registered"));
    }

    if (!isReady) {
      if (holdsIntentWhile(notReadyReason)) return false;
      failStart(NOT_READY_REFUSALS[notReadyReason], new Error("Engine not ready"));
    }

    // 局面が無いとき ▶ は `disabled` で、文が画面に出る操作が無いので断りを立てない。
    if (!currentSfen) throw new Error("No position available for analysis");
    return true;
  }, [isReady, notReadyReason, currentSfen, failStart]);

  /**
   * 盤の局面をエンジンへ送って追いつくのを待ち、席を取ってよければ `true` を返す。
   * 追いつかなければ断りを立てて投げる。要らなくなった要求と、エンジンの起動を待つときは `false`。
   *
   * 待つ相手は `currentSfenRef` で読む。押した瞬間の値を待つと、盤が動いたときに条件が真にならない。
   */
  const sendAndAwaitSync = useCallback(
    async (seq: number) => {
      const generation = seat.engineGeneration();
      // `syncPosition` は `set_position` の失敗を投げる。覚えさせられないならエンジンが居ない。
      try {
        await syncPosition();
      } catch (e) {
        if (supersededSince(seq)) return false;
        failUnreachable(e, generation);
      }

      // 同期を待たずに始めると、前の局面の候補手が盤面と一致しないまま出る。
      const synced = await waitUntil(
        () => currentSfenRef.current !== null && syncedSfenRef.current === currentSfenRef.current,
        waits().positionSyncTimeoutMs,
        () => supersededSince(seq) || !readinessRef.current.isReady,
      );
      if (!synced) {
        if (supersededSince(seq)) return false;

        // エンジンが消えたら上限まで待たない。起動を待っているなら意思を残し、戻らないなら理由で断る。
        const engine = readinessRef.current;
        if (!engine.isReady) {
          if (holdsIntentWhile(engine.notReadyReason)) {
            dispatch({ type: "hold_intent" });
            return false;
          }
          failStart(
            NOT_READY_REFUSALS[engine.notReadyReason],
            new Error("engine went away while syncing"),
          );
        }

        failStart(POSITION_SYNC_TIMEOUT_MESSAGE, new Error("position sync timed out"));
      }

      // `go` の前にも見る。抜かすと、誰も見ていない探索が1往復ぶん走る。
      return !supersededSince(seq);
    },
    [seat, syncPosition, supersededSince, failStart, failUnreachable],
  );

  /**
   * 応答待ちの自動再開を待ち、続けてよければ `true` を返す。
   *
   * Rust は席を取ってから `go` を待つ（`bridge.rs` の `start_infinite_analysis_impl`）ので、その往復の
   * 間に ▶ を押すと `take_session` に断られる。席の欄は空なので、`releaseHeld` の待ちでは足りない。
   */
  const awaitInFlightRestart = useCallback(
    async (seq: number) => {
      const restarting = restartInFlightRef.current;
      if (!restarting) return true;

      await restarting.catch(() => {});
      return !supersededSince(seq);
    },
    [supersededSince],
  );

  /**
   * 握っている席を開始の前に返し、続けてよければ `true` を返す。返せなければ `応答なし` にして投げる。
   *
   * 停止が届かないと席を握ったまま `isAnalyzing` が false になり、■ は出ていない。
   * 返さずに開始を頼むと Rust に断られ続ける。
   */
  const releaseHeldBeforeStart = useCallback(
    async (seq: number) => {
      const generation = seat.engineGeneration();
      let released: StopOutcome = "stopped";
      try {
        released = await seat.releaseHeld("start");
      } catch (e) {
        if (supersededSince(seq)) return false;
        failUnreachable(e, generation);
      }
      // 答えが無ければ語が `応答なし` に変わる。開始を頼むと断りの文が立つ
      if (released === "unanswered") {
        dispatch({ type: "hold_intent" });
        return false;
      }
      return !supersededSince(seq);
    },
    [seat, supersededSince, failUnreachable],
  );

  /**
   * ▶ の本体。応答待ちの自動再開を待ち、握っている席を返し、局面を送って追いつくのを待ってから、
   * 席を取って `go` を出す。
   *
   * 3つの段は先へ進めなければ `false` を返し、断りは段の側が `failStart` で立てる。席を取る段の
   * 結末はエンジンが消えたときと利用者が降りたときで出す物が違うので、ここで書き分ける。
   *
   * **`seq` は返却より前に読む。** 返却の往復の間に世代が上がると、以降の判定が効かない。
   */
  const startInfiniteAnalysis = useCallback(async () => {
    if (state.isAnalyzing) return;
    if (!refuseIfCannotStart()) {
      dispatch({ type: "hold_intent" });
      return;
    }

    const seq = restartSeqRef.current;

    if (!(await awaitInFlightRestart(seq))) return;
    if (!(await releaseHeldBeforeStart(seq))) return;
    if (!(await sendAndAwaitSync(seq))) return;

    // 待ち切った局面で始める。押した瞬間の局面とは違うことがある。
    const want = currentSfenRef.current;
    if (!want) return;

    // `.catch()` を挟まない。微小タスクが1つ増えると、開始の応答とアンマウントが同じバッチに入ったときに
    // 席を返す側が間に合わない（`provider.test.tsx`）。
    let taken: SeatTakeResult = "superseded";
    try {
      taken = await takeSeatAndGo(seq, want, "late-start");
    } catch (e) {
      if (supersededSince(seq)) return;
      failStart(START_REFUSED_MESSAGE, e);
    }
    // エンジンが消えたら検討の意思を残し、戻らないなら理由で断る。要らなくなった要求も
    // `receiveSeat` はエンジンを先に見るのでここへ来るが、出す先の画面が無いので除く。
    if (taken === "engine-gone" && !supersededSince(seq)) {
      const engine = readinessRef.current;
      if (engine.isReady || holdsIntentWhile(engine.notReadyReason)) {
        dispatch({ type: "hold_intent" });
        return;
      }
      failStart(
        NOT_READY_REFUSALS[engine.notReadyReason],
        new Error("engine was restarted while taking a seat"),
      );
    }
    if (taken !== "held" && taken !== "finished") return;

    desiredSfenRef.current = want;
  }, [
    state.isAnalyzing,
    refuseIfCannotStart,
    awaitInFlightRestart,
    releaseHeldBeforeStart,
    sendAndAwaitSync,
    failStart,
    supersededSince,
    takeSeatAndGo,
  ]);

  // 応答待ちの間に呼ばれても1本にする。`isAnalyzing` が立つのは席が返った後で、2本目は `take_session` に断られる。
  const startInfiniteAnalysisOnce = useCallback(async () => {
    const running = startInFlightRef.current;
    if (running) return running;

    // 語は押した時点で変える。席を返す往復と局面の同期の間、画面が動かないと失敗に見える
    dispatch({ type: "begin_start" });
    const started = startInfiniteAnalysis().finally(() => {
      startInFlightRef.current = null;
      dispatch({ type: "end_start" });
    });
    startInFlightRef.current = started;
    return started;
  }, [startInfiniteAnalysis]);

  const stopAnalysis = useCallback(async () => {
    // 世代は返却より先に上げる。上げないと、応答待ちの開始が返った席を握り、止めたのに走り続ける。
    supersedeRequests();
    dispatch({ type: "begin_stop" });

    const generation = seat.engineGeneration();
    try {
      await seat.releaseHeld("stop"); // async-result-ignored: `応答なし` は Rust の通知が語を変える
    } catch (e) {
      // `待機中` にしない。エンジンは探索を回し続けているかもしれない
      reportUnreachableSince(generation);
      throw e;
    } finally {
      dispatch({ type: "stop_analysis" });
      results.dropPending();
    }
  }, [reportUnreachableSince, results, seat, supersedeRequests]);

  const value = useMemo<AnalysisContextType>(
    () => ({
      state,
      candidateCache,
      startInfiniteAnalysis: startInfiniteAnalysisOnce,
      stopAnalysis,
    }),
    [state, candidateCache, startInfiniteAnalysisOnce, stopAnalysis],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
