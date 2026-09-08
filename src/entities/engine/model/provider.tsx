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
  // **`desiredRuntime` の有無を先に見る。** 無ければ、下の effect は `shutdown` して
  // 降りるだけで**起動し直す口が1つも無い**——`phase` が何であれ結末は同じなので、
  // `phase` に先を譲ると、その窓で「オプションを変えて保存」と案内することになる
  // （起こし直す材料が揃っていないのに）。
  //
  // 残りを `phase` で割る。`error` は同じ設定では再トライしない（→ engine.md の ※5）ので戻らず、
  // それ以外は必ずどこかの枝が起動し直す。**`idle` を「選んでいない」に落とさない**
  // ——起こし直しの途中（下の effect が `idle` から拾い直す窓）がそこへ来るので、
  // 落とすと読み手が「待てば戻る」を見分けられなくなる
  // （解析側は理由で打ち切るかを決める → `docs/state-transitions/analysis.md` の ※5）。
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
