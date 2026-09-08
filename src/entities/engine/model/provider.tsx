import { reducer, initialState } from "./reducer";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  EngineContextType,
  EngineNotReadyReason,
  EngineReadiness,
  EngineRuntimeConfig,
} from "./types";
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

  // **理由はここで決める。** `desiredRuntime` を見られるのはこの provider だけなので、
  // 解析側からは「選んでいない」と「起こし直している最中」を区別できない。
  //
  // **`phase` で割らない。** 起こし直しは `ready → idle → initializing` を通り
  // （`restart()` は `shutdown()` を await してから `initialize()`）、その `idle` は
  // **必ず commit される**。`phase` を並べると `idle` の枝を書き落とし、
  // 「設定でエンジンを選んでください」——この型が避けるために在る文言——が出る。
  //
  // **選んでいるかどうかで割る。** `desiredRuntime` が在る限り、**初期化が落ちている段を
  // 除いて**どの段でも、利用者から見れば「起動を待っている」。
  // `"no-engine"` の doc（「まだ選んでいない」）とも一致する。
  //
  // **選んでいるかを先に見る。** `error` を先に見ると、壊れたプリセットの選択を外した
  // 直後——`desiredRuntime` が null になってから `phase` が `idle` へ戻るまでの
  // 本物の IPC 往復——に「設定でエンジンのオプションを変えて保存」と案内する。
  // **もう選んでいないプリセット**のオプションを変えろ、という実行できない案内になる。
  const notReadyReason: EngineNotReadyReason = !desiredRuntime
    ? "no-engine"
    : state.phase === "error"
      ? "failed"
      : "starting";

  // **合併にしてから配る。** 2つの欄を独立に持たせると、呼び手が
  // `notReadyReason ?? "既定値"` を書くことになり、その既定値が理由を取り違える。
  const readiness: EngineReadiness = useMemo(
    () => (isReady ? { isReady: true, notReadyReason: null } : { isReady: false, notReadyReason }),
    [isReady, notReadyReason],
  );

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
      if (state.phase === "ready" || state.phase === "initializing" || state.phase === "error") {
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
  }, [desiredRuntime, state.phase, state.activeRuntime, initialize, shutdown, restart]);

  const value = useMemo<EngineContextType>(
    () => ({
      state,
      ...readiness,
      initialize,
      shutdown,
      restart,
      clearError,
    }),
    [state, readiness, initialize, shutdown, restart, clearError],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
