import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { AnalysisCandidate, EngineRuntimeConfig } from "@/entities/engine";
import {
  asMateStartFailureKind,
  setupMateEventListeners,
  startMateSearch,
  stopMateSearch,
} from "../api/tauri";
import type { MateSearchFinished, MateSearchUpdate, MateSessionId } from "../api/rust-types";
import { MateSearchContext } from "./context";
import { initialState, isRunning, mateSearchReducer } from "./reducer";
import type { MateSearchContextType } from "./types";

type Props = {
  children: ReactNode;
  /** 盤の局面。棋譜を開いていなければ `null` */
  currentSfen: string | null;
  /** 詰み探索に使うプリセットの設定。指定が無い・エンジンが未設定なら `null` */
  engine: EngineRuntimeConfig | null;
  /** 上限時間。`null` は無制限 */
  limitMs: number | null;
  /** 検討の意思があるか、▶ を押して始まるところか */
  analysisBusy: boolean;
  /** 検討を中断し、検討の意思を下ろす。届かなければ reject する */
  stopAnalysis: () => Promise<void>;
};

/** 途中経過を画面へ流す間隔（ミリ秒）。通常のエンジンは1秒に何百行も流す */
const UPDATE_INTERVAL_MS = 100;

/**
 * 詰み探索の状態を子へ渡し、探索の寿命を持つ。遷移の表は `docs/state-transitions/mate-search.md`。
 *
 * **ドックのタブより上に置く。** タブを移っても詰み探索は止めない（AC-M11）。
 *
 * 検討との排他は Rust が持つ（`bridge.rs` の `start_mate_search_impl`）。ここは検討の意思を下ろすことと、
 * 表をどちらのものとして出すかを持つ
 */
export function MateSearchProvider({
  children,
  currentSfen,
  engine,
  limitMs,
  analysisBusy,
  stopAnalysis,
}: Props) {
  const [state, dispatch] = useReducer(mateSearchReducer, initialState);

  // await の後と通知の受け手が読む最新の値
  const stateRef = useRef(state);
  stateRef.current = state;

  /** 始めるリクエストの世代。中止と閉じるで上がり、待っていた古いリクエストは何も書かない */
  const seqRef = useRef(0);
  /** いま表に出している探索の番号。通知はこれと照合する */
  const sessionRef = useRef<MateSessionId | null>(null);
  /** 番号を待つ間に届いた通知。応答より先に着くので、番号が分かってから当てる */
  const earlyRef = useRef(new Map<MateSessionId, MateSearchUpdate | MateSearchFinished>());
  const awaitingRef = useRef(false);
  /** 利用者がボタンで中止した世代 */
  const cancelledSeqRef = useRef(-1);
  /** 動いているはずの詰将棋エンジンの設定。同じ設定なら起動中の語を出さない */
  const warmRef = useRef<string | null>(null);

  /**
   * 最後に送った中止。次の探索は、これが返ってから始める。
   *
   * Tauri のコマンドは別々のタスクで走るので、送った順に着くとは限らない。待たないと、前の探索の中止が
   * 後から着いて、始めたばかりの探索を止める
   */
  const lastStopRef = useRef<Promise<void>>(Promise.resolve());
  const stop = useCallback((): Promise<void> => {
    const stopped = stopMateSearch();
    lastStopRef.current = stopped.catch(() => {});
    return stopped;
  }, []);

  const pendingRef = useRef<{ sessionId: MateSessionId; candidates: AnalysisCandidate[] } | null>(
    null,
  );
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dropPending = useCallback(() => {
    pendingRef.current = null;
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }, []);

  const receiveUpdate = useCallback(({ sessionId, result }: MateSearchUpdate) => {
    pendingRef.current = { sessionId, candidates: result.candidates };
    flushTimerRef.current ??= setTimeout(() => {
      flushTimerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) dispatch({ type: "update", ...pending });
    }, UPDATE_INTERVAL_MS);
  }, []);

  const receiveFinished = useCallback(
    ({ sessionId, result, conclusion }: MateSearchFinished) => {
      sessionRef.current = null;
      dropPending();
      dispatch({
        type: "finish",
        sessionId,
        candidates: result.candidates,
        outcome: conclusion,
        now: Date.now(),
      });
    },
    [dropPending],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let unlisten: (() => void) | null = null;

    setupMateEventListeners({
      onUpdate: (update) => {
        if (update.sessionId === sessionRef.current) receiveUpdate(update);
        else if (awaitingRef.current) earlyRef.current.set(update.sessionId, update);
      },
      onFinished: (finished) => {
        // 落としたエンジンは、どの探索のものでも次に起動し直す
        const { kind } = finished.conclusion;
        if (kind === "engineExited" || kind === "stopUnanswered") warmRef.current = null;

        if (finished.sessionId === sessionRef.current) receiveFinished(finished);
        else if (awaitingRef.current) earlyRef.current.set(finished.sessionId, finished);
      },
    }).then(
      (fn) => {
        if (alive) unlisten = fn;
        else fn();
      },
      (e: unknown) => console.error("[MATE] could not listen to the mate search", e),
    );

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [receiveUpdate, receiveFinished]);

  // ワークスペースの切り替えは webview を読み込み直すので、前の画面の探索が Rust に残る。
  // 残っていれば、誰も見ていない探索がエンジンを回し続ける
  useEffect(() => {
    const stopLeftover = () => {
      if (!isTauri()) return;
      stop().catch((e: unknown) => console.warn("[MATE] could not stop the leftover search", e));
    };
    stopLeftover();
    return () => {
      seqRef.current += 1;
      dropPending();
      stopLeftover();
    };
  }, [dropPending, stop]);

  const dismiss = useCallback(() => {
    const { phase } = stateRef.current;
    if (phase === "closed") return;

    seqRef.current += 1;
    sessionRef.current = null;
    awaitingRef.current = false;
    earlyRef.current.clear();
    dropPending();
    dispatch({ type: "close" });

    if (phase === "starting" || phase === "searching") {
      stop().catch((e: unknown) => console.error("[MATE] could not stop the mate search", e));
    }
  }, [dropPending, stop]);

  // 局面が変わったら結論も候補手も古い。検討の意思は立てない（▶ を押したときだけ始まる）
  useEffect(() => {
    if (state.phase !== "closed" && state.sfen !== currentSfen) dismiss();
  }, [state, currentSfen, dismiss]);

  const start = useCallback(async () => {
    if (!engine || !currentSfen) return;
    const sfen = currentSfen;
    const seq = ++seqRef.current;
    const superseded = () => seqRef.current !== seq;

    if (analysisBusy) {
      dispatch({ type: "prepare", sfen });
      try {
        await stopAnalysis();
      } catch (e) {
        // 検討の語が `応答なし` になる。詰み探索は始めない（AC-M5）
        console.error("[MATE] could not stop the analysis first", e);
        if (!superseded()) dispatch({ type: "close" });
        return;
      }
      if (superseded()) return;
    }

    const engineKey = JSON.stringify(engine);
    dispatch({ type: "begin", sfen, warm: warmRef.current === engineKey, now: Date.now() });
    warmRef.current = null;
    sessionRef.current = null;
    awaitingRef.current = true;
    earlyRef.current.clear();

    await lastStopRef.current;
    if (superseded()) return;
    if (cancelledSeqRef.current === seq) {
      awaitingRef.current = false;
      dispatch({ type: "fail", outcome: { kind: "cancelled" } });
      return;
    }

    let sessionId: MateSessionId;
    try {
      sessionId = await startMateSearch({ engine, position: sfen, limitMs });
    } catch (e) {
      if (superseded()) return;
      awaitingRef.current = false;
      const kind = asMateStartFailureKind(e);
      console.warn("[MATE] start refused", e);
      if (kind === "superseded" && cancelledSeqRef.current === seq) {
        dispatch({ type: "fail", outcome: { kind: "cancelled" } });
      } else if (kind === "superseded" || kind === "analysisUnresponsive") {
        dispatch({ type: "close" });
      } else {
        dispatch({
          type: "fail",
          outcome: { kind: kind === "engineFailed" ? "startFailed" : "refused" },
        });
      }
      return;
    }
    // 要らなくなった探索は、閉じた側の `stopMateSearch` が止めている
    if (superseded()) return;

    awaitingRef.current = false;
    warmRef.current = engineKey;
    sessionRef.current = sessionId;
    dispatch({ type: "accept", sessionId, now: Date.now() });

    const early = earlyRef.current.get(sessionId);
    earlyRef.current.clear();
    if (!early) return;
    if ("conclusion" in early) {
      const { kind } = early.conclusion;
      if (kind === "engineExited" || kind === "stopUnanswered") warmRef.current = null;
      receiveFinished(early);
    } else {
      receiveUpdate(early);
    }
  }, [engine, currentSfen, limitMs, analysisBusy, stopAnalysis, receiveFinished, receiveUpdate]);

  const cancel = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase === "preparing") {
      dismiss();
      return;
    }
    if (current.phase !== "starting" && current.phase !== "searching") return;
    if (current.stopping) return;

    const seq = seqRef.current;
    cancelledSeqRef.current = seq;
    dispatch({ type: "begin_stop" });
    try {
      await stop();
    } catch (e) {
      console.error("[MATE] could not stop the mate search", e);
      if (seqRef.current === seq) dispatch({ type: "end_stop" });
    }
  }, [dismiss, stop]);

  const toggle = useCallback(
    () => (isRunning(stateRef.current) ? cancel() : start()),
    [cancel, start],
  );

  const ownsTable =
    state.phase !== "closed" && state.phase !== "preparing" && state.sfen === currentSfen;

  const value = useMemo<MateSearchContextType>(
    () => ({ state, ownsTable, available: engine !== null, toggle, dismiss }),
    [state, ownsTable, engine, toggle, dismiss],
  );

  return <MateSearchContext.Provider value={value}>{children}</MateSearchContext.Provider>;
}
