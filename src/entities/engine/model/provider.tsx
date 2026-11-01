import { isTauri } from "@tauri-apps/api/core";
import { reducer, initialState } from "./reducer";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { EngineContextType, EngineReadiness, EngineRuntimeConfig } from "./types";
import { equalRuntime } from "../lib/equalRuntime";
import { engineInitializer } from "../api/initializer";
import { setupEngineEventListeners } from "../api/events";
import { asStartFailure } from "../lib/engineFailure";
import { lifecycleStepOf } from "../lib/lifecycleStep";
import { notReadyReasonOf } from "../lib/notReadyReason";
import { nextRequestNumber } from "../api/requestNumber";
import { EngineContext } from "./context";
import { useSlowStart } from "./useSlowStart";

type Props = {
  children: ReactNode;
  desiredRuntime: EngineRuntimeConfig | null;
  /** プリセットは選んだが `desiredRuntime` を組めない。選んでいないときと言い分けるために要る */
  presetIncomplete?: boolean;
};

/** 次の要求の番号を取って記録する。これより古い要求の結果は捨てられる */
function issueRequest(lastRequestRef: RefObject<number>): number {
  const request = nextRequestNumber();
  lastRequestRef.current = request;
  return request;
}

export function EngineProvider({ children, desiredRuntime, presetIncomplete = false }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const slowStart = useSlowStart(state.phase === "initializing");

  // 最後の起動または停止の要求の番号
  const lastRequestRef = useRef(0);
  const lastTriedRuntimeRef = useRef<EngineRuntimeConfig | null>(null);
  /**
   * 終わったと知らされた起動の番号。`readyok` の直後に終わったプロセスは、起動の応答より先に通知が
   * 着く。そのとき `engine_exited` は `initializing` に当たって捨てられるので、応答を書いた直後に読み直す
   */
  const exitedRequestRef = useRef<{ request: number; lastOutput: string | null } | null>(null);

  const isReady =
    state.phase === "ready" &&
    !!state.engineInfo &&
    !!desiredRuntime &&
    !!state.activeRuntime &&
    equalRuntime(desiredRuntime, state.activeRuntime);

  const notReadyReason = notReadyReasonOf({
    chosen: !!desiredRuntime,
    presetIncomplete,
    phase: state.phase,
    failureKind: state.error?.kind ?? null,
  });

  const readiness: EngineReadiness = useMemo(
    () => (isReady ? { isReady: true, notReadyReason: null } : { isReady: false, notReadyReason }),
    [isReady, notReadyReason],
  );

  // 起動中でも呼んでよい。前の起動は Rust が落とし（前の呼び出しは `cancelled` で断られる）、その結果は
  // `lastRequestRef` で捨てる。起動中に設定が変わったとき（`engine.md` の (S1, E3)）がここを通る
  const initialize = useCallback(async (): Promise<void> => {
    if (!desiredRuntime) return;

    const request = issueRequest(lastRequestRef);

    const snapshot = structuredClone(desiredRuntime);
    lastTriedRuntimeRef.current = snapshot;
    dispatch({ type: "initialize_start" });

    try {
      const outcome = await engineInitializer.initialize(desiredRuntime, request);
      if (lastRequestRef.current !== request) return;

      dispatch({
        type: "initialize_success",
        payload: {
          engineInfo: outcome.info,
          activeRuntime: snapshot,
          warnings: outcome.warnings,
        },
      });
      if (exitedRequestRef.current?.request === request) {
        dispatch({ type: "engine_exited", payload: exitedRequestRef.current.lastOutput });
      }
    } catch (e) {
      if (lastRequestRef.current !== request) return;
      dispatch({ type: "initialize_error", payload: asStartFailure(e) });
    }
  }, [desiredRuntime]);

  const shutdown = useCallback(async (): Promise<void> => {
    const request = issueRequest(lastRequestRef);
    try {
      await engineInitializer.shutdown(request);
    } finally {
      // 停止の往復の間に次の起動が始まっていたら `idle` を書かない。書くと起動中の段が `idle` に落ち、
      // `lifecycleStepOf` が同じ設定でもう1回起動して、進行中の起動が捨てられる
      if (lastRequestRef.current === request) dispatch({ type: "shutdown" });
    }
  }, []);

  const cancelStart = useCallback((): void => {
    const request = issueRequest(lastRequestRef);
    // 失敗として止める。`idle` に戻すと、設定が選ばれたままなので effect が起動し直す
    dispatch({
      type: "initialize_error",
      payload: {
        kind: "cancelled",
        message: "the user stopped the engine start",
        lastOutput: null,
      },
    });
    engineInitializer.shutdown(request).catch((e: unknown) => {
      console.error("[engine] 起動を中止する停止に失敗した", e);
    });
  }, []);

  const restart = useCallback(async (): Promise<void> => {
    await shutdown();
    await initialize();
  }, [shutdown, initialize]);

  const reportUnreachable = useCallback(() => {
    dispatch({
      type: "engine_unresponsive",
      payload: { reason: "unwritable", lastOutput: null },
    });
  }, []);

  // 番号が最後の要求のものだけ採る。起動し直しの間は古いプロセスの通知が届く。
  // 読み手は `dispatch` と ref だけなので、購読はマウントの1回でよい
  useEffect(() => {
    if (!isTauri()) return;

    let alive = true;
    let unlisten: (() => void) | null = null;
    const current = (request: number) => request === lastRequestRef.current;
    setupEngineEventListeners({
      onExited: (request, lastOutput) => {
        if (!current(request)) return;
        exitedRequestRef.current = { request, lastOutput };
        dispatch({ type: "engine_exited", payload: lastOutput });
      },
      onUnresponsive: (request, reason, lastOutput) => {
        if (current(request)) {
          dispatch({ type: "engine_unresponsive", payload: { reason, lastOutput } });
        }
      },
      onAnswered: (request) => {
        if (current(request)) dispatch({ type: "engine_answered" });
      },
    })
      .then((stop) => {
        if (alive) unlisten = stop;
        else stop();
      })
      .catch((e: unknown) => {
        console.error("[engine] プロセスの通知を購読できなかった", e);
      });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const step = lifecycleStepOf({
      desiredRuntime,
      phase: state.phase,
      activeRuntime: state.activeRuntime,
      lastTriedRuntime: lastTriedRuntimeRef.current,
    });
    if (step === "start") initialize().catch(() => {});
    if (step === "restart") restart().catch(() => {});
    if (step === "shutdown") shutdown().catch(() => {});
  }, [desiredRuntime, state.phase, state.activeRuntime, initialize, shutdown, restart]);

  const value = useMemo<EngineContextType>(
    () => ({
      state,
      ...readiness,
      initialize,
      cancelStart,
      slowStart,
      presetIncomplete,
      reportUnreachable,
    }),
    [state, readiness, initialize, cancelStart, slowStart, presetIncomplete, reportUnreachable],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
