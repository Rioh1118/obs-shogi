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
  // **最新の設定を ref でも持つ。** `initialize` は `await` の向こうから呼ばれる回が
  // あるので、クロージャの値だと古い設定で起こし直す（下の `initialize` の先頭）。
  const desiredRuntimeRef = useRef(desiredRuntime);
  desiredRuntimeRef.current = desiredRuntime;

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
  // 割るのは2段で、下の三項が `desiredRuntime` の有無を見て、残りを `reasonForPhase` が
  // `phase` で割る。**この2段を入れ替えるときは ※7 の表も一緒に直すこと。**
  // **述語の呼び出しは描画時のここ1箇所。** 三項も下の effect もこの値を読む。
  // **effect の中で呼び直さない**——`lastTriedRef` の更新は再描画を起こさないので、
  // 呼んだ時点によって答えが割れる。
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
    // **描画時の値ではなく、撃つ時点の値で起動する。** `restart()` は `shutdown()` を
    // 待ってから呼ぶので、その間（現物では畳みの猶予ぶん）に利用者がもう一度保存すると、
    // クロージャに焼き付いた設定＝**すでに捨てられた設定**で起こし直すことになる。
    const desired = desiredRuntimeRef.current;
    if (!desired) return false;
    // **門は ref。** `state.phase` は描画のクロージャの値なので、同じコミットで
    // setup が2回走る回（StrictMode）には `initialize_start` を撃った後でも
    // `"idle"` のまま見え、2本目が通る。**2本目を止めているのはこの門**
    // （`provider.test.tsx` の StrictMode が固定している。`engineInitializer` を
    // 差し替えた double で通るので、畳み込みではなくここが効いている）。
    // `engineInitializer` 側の in-flight の畳み込みは provider ごと張り直した回の保険で、
    // **1つの provider の中では踏めない**。
    //
    // **門が閉じたまま残らないことは `shutdown` 側が守る**（そこで必ず落とす）。
    // ここが世代を持つのは `finally` のためで、**自分が握っている回だけ空ける**
    // ——無条件に空けると、畳みに追い越された1本が着地した時点で門が開き、
    // 飛んでいる起動の上にもう1本が重なる。
    if (startingSeqRef.current !== null) return false;

    const mySeq = ++seqRef.current;
    startingSeqRef.current = mySeq;

    const snap: EngineRuntimeConfig =
      typeof structuredClone === "function"
        ? structuredClone(desired)
        : JSON.parse(JSON.stringify(desired));

    lastTriedRef.current = snap;
    dispatch({ type: "initialize_start" });

    try {
      const info = await engineInitializer.initialize(desired);
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
  }, []);

  const shutdown = useCallback(async (): Promise<void> => {
    const mySeq = ++seqRef.current;
    // **世代を上げたら門も落とす。** ここを飛ばすと、飛んでいる起動が返らない限り
    // 次の `initialize` が撃てない（上の門の TSDoc）。
    startingSeqRef.current = null;
    try {
      await engineInitializer.shutdown();
    } finally {
      // **`await` の向こうでも世代を見る。** 畳みは飛んでいる起動を待つ回があるので、
      // 眠っている間に新しいエンジンが起き切ることがある。そこで無条件に `idle` を撃つと、
      // **健全なエンジンを畳んだことにして**起こし直しが1回まるごと余分に走る。
      // IPC の側を止めるのは `api/initializer.ts` の同じ世代の門で、ここだけでは足りない。
      if (seqRef.current === mySeq) dispatch({ type: "shutdown" });
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
    // **上で計算した値をそのまま読む**——ここで呼び直すと、理由を決めた描画とこの effect が
    // 別の `lastTriedRef` を見て、起動し直しているのに解析側が終端と読む窓ができる。
    // （この値は `desiredRuntime` と `lastTriedRef` から決まり、`lastTriedRef` が動く回は
    // 必ず `initialize_start` が同じ回に飛ぶので、依存としては導出可能。
    // それでも並べてあるのは `react-hooks/exhaustive-deps` が error だから。）
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
