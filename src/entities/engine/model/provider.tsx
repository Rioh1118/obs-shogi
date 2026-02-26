import { reducer, initialState } from "./reducer";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { EngineContextType, EngineRuntimeConfig } from "./types";
import { equalRuntime } from "../lib/equalRuntime";
import { engineInitializer } from "../api/initializer";
import { EngineContext } from "./context";

type Props = {
  children: React.ReactNode;
  desiredRuntime: EngineRuntimeConfig | null;
};

export function EngineProvider({ children, desiredRuntime }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const seqRef = useRef(0);
  const lastTriedRef = useRef<EngineRuntimeConfig | null>(null);

  const isReady =
    state.phase === "ready" &&
    !!state.engineInfo &&
    !!desiredRuntime &&
    !!state.activeRuntime &&
    equalRuntime(desiredRuntime, state.activeRuntime);

  // lifecycle
  const initialize = useCallback(async (): Promise<boolean> => {
    if (!desiredRuntime) return false;
    if (state.phase === "initializing") return false;

    const mySeq = ++seqRef.current;

    const snap: EngineRuntimeConfig =
      typeof structuredClone === "function"
        ? structuredClone(desiredRuntime)
        : JSON.parse(JSON.stringify(desiredRuntime));

    lastTriedRef.current = snap;
    dispatch({ type: "initialize_start" });

    try {
      const info = await engineInitializer.initialize(desiredRuntime);
      if (seqRef.current !== mySeq) return false;

      dispatch({
        type: "initialize_success",
        payload: {
          engineInfo: info,
          activeRuntime: snap,
        },
      });

      return true;
    } catch (e) {
      if (seqRef.current !== mySeq) return false;
      dispatch({
        type: "initialize_error",
        payload: `Engine initialization failed: ${String(e)}`,
      });
      return false;
    }
  }, [desiredRuntime, state.phase]);

  const shutdown = useCallback(async (): Promise<void> => {
    seqRef.current++;
    try {
      await engineInitializer.shutdown();
    } finally {
      dispatch({ type: "shutdown" });
    }
  }, []);

  const restart = useCallback(async (): Promise<boolean> => {
    await shutdown();
    return await initialize();
  }, [shutdown, initialize]);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  useEffect(() => {
    // 設定が無い → 起動中なら止める
    if (!desiredRuntime) {
      if (
        state.phase === "ready" ||
        state.phase === "initializing" ||
        state.phase === "error"
      ) {
        shutdown().catch(() => {});
      }
      return;
    }

    // error でも「別設定なら」再トライする（同一設定なら止める）
    if (state.phase === "error") {
      const last = lastTriedRef.current;
      const sameRuntime = last ? equalRuntime(desiredRuntime, last) : false;
      if (!sameRuntime) initialize().catch(() => {});
      return;
    }

    // idle → 起動
    if (state.phase === "idle") {
      initialize().catch(() => {});
      return;
    }

    // ready で設定が変わった → 再起動
    if (state.phase === "ready" && state.activeRuntime) {
      const runtimeChanged = !equalRuntime(desiredRuntime, state.activeRuntime);

      if (runtimeChanged) {
        restart().catch(() => {});
      }
    }
  }, [
    desiredRuntime,
    state.phase,
    state.activeRuntime,
    initialize,
    shutdown,
    restart,
  ]);

  const value = useMemo<EngineContextType>(
    () => ({
      state,
      isReady,
      initialize,
      shutdown,
      restart,
      clearError,
    }),
    [state, isReady, initialize, shutdown, restart, clearError],
  );

  return (
    <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
  );
}
