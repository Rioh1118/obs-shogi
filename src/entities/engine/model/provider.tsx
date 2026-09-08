import { reducer, initialState } from "./reducer";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  EngineContextType,
  EngineNotReadyReason,
  EngineReadiness,
  EngineRuntimeConfig,
} from "./types";
import { equalRuntime } from "../lib/equalRuntime";
import { reasonForPhase, retriesAfterError } from "../lib/notReadyReason";
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
  const startingSeqRef = useRef<number | null>(null);

  const isReady =
    state.phase === "ready" &&
    !!state.engineInfo &&
    !!desiredRuntime &&
    !!state.activeRuntime &&
    equalRuntime(desiredRuntime, state.activeRuntime);

  // **理由はここで決める**——`desiredRuntime` を見られるのはこの provider だけなので、
  // 解析側からは「選んでいない」と「起こし直している最中」を区別できない。
  //
  // **理由の割り方と、当たる順の根拠は `docs/state-transitions/engine.md` の ※7。**
  // 向こうの表はこの三項の並びに追随しているので、順を変えるときは一緒に直すこと。
  // **述語の呼び出しは描画時のここ1箇所。** 三項も下の effect もこの値を読み、
  // **effect の依存にも載せる**——effect の中で呼び直すと、`lastTriedRef` の更新は
  // 再描画を起こさないので取りこぼす。
  const willRetryAfterError = retriesAfterError({
    desired: desiredRuntime,
    lastTried: lastTriedRef.current,
  });

  const notReadyReason: EngineNotReadyReason = !desiredRuntime
    ? "no-engine"
    : reasonForPhase(state.phase, willRetryAfterError);

  // **合併にしてから配る。** 2つの欄を独立に持たせると、呼び手が
  // `notReadyReason ?? "既定値"` を書くことになり、その既定値が理由を取り違える。
  const readiness: EngineReadiness = useMemo(
    () => (isReady ? { isReady: true, notReadyReason: null } : { isReady: false, notReadyReason }),
    [isReady, notReadyReason],
  );

  // lifecycle
  const initialize = useCallback(async (): Promise<boolean> => {
    if (!desiredRuntime) return false;
    // **門は ref。** `state.phase` は描画のクロージャの値なので、同じコミットで
    // setup が2回走る回（StrictMode）には `initialize_start` を撃った後でも
    // `"idle"` のまま見え、2本目が通る。いま2プロセスにならないのは
    // `engineInitializer` 側が in-flight を畳んでいるからで、この門ではない。
    //
    // **持つのは世代であって bool ではない。** 畳む側は飛んでいる起動を待ち切るとは
    // 限らない（`api/initializer.ts` の `shutdown` は `await` の前に `inFlight` を
    // 空けるので、2本目は待たずに戻る）。bool だと、その回に降ろす者が居ないまま
    // `phase` が `idle` へ落ち、**エンジンが二度と起動しない**——しかもそのときの理由は
    // `starting`（戻る側）なので、解析は誰にも断たれずに回り続ける。
    if (startingSeqRef.current !== null) return false;

    const mySeq = ++seqRef.current;
    startingSeqRef.current = mySeq;

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
    } finally {
      // 畳まれて世代が上がっていたら、門を握っているのはもう自分ではない。
      if (startingSeqRef.current === mySeq) startingSeqRef.current = null;
    }
  }, [desiredRuntime]);

  const shutdown = useCallback(async (): Promise<void> => {
    seqRef.current++;
    // **世代を上げたら門も落とす。** ここを飛ばすと、飛んでいる起動が返らない限り
    // 次の `initialize` が撃てない（上の門の TSDoc）。
    startingSeqRef.current = null;
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

    // error でも「別設定なら」再トライする（同一設定なら止める）。
    // **上で計算した値をそのまま読む**（依存にも載せてある）——ここで呼び直すと、
    // `lastTriedRef` の更新を取りこぼし、起動し直しているのに解析側が終端と読む。
    if (state.phase === "error") {
      if (willRetryAfterError) initialize().catch(() => {});
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
    willRetryAfterError,
    initialize,
    shutdown,
    restart,
  ]);

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
