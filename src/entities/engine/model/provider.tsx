import { isTauri } from "@tauri-apps/api/core";
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
import { setupEngineEventListeners } from "../api/events";
import { asStartFailure } from "../lib/engineFailure";
import { nextRequestNumber } from "../api/requestNumber";
import { EngineContext } from "./context";
import { useSlowStart } from "./useSlowStart";

type Props = {
  children: React.ReactNode;
  desiredRuntime: EngineRuntimeConfig | null;
  /** プリセットは選んだが `desiredRuntime` を組めない。**選んでいない回と言い分けるために要る** */
  presetIncomplete?: boolean;
};

export function EngineProvider({ children, desiredRuntime, presetIncomplete = false }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const slowStart = useSlowStart(state.phase === "initializing");

  // 最後に撃った起動・停止の番号。番号は `nextRequestNumber`（webview を読み直しても下がらない）
  const seqRef = useRef(0);
  const lastTriedRef = useRef<EngineRuntimeConfig | null>(null);
  /**
   * 終わったと知らされた起動の番号。**起動の応答より先に通知が着く回のために持つ**
   * （`readyok` の直後に終わったプロセス）。その回は `engine_exited` が `initializing` に
   * 当たって捨てられるので、応答を書いた直後に読み直す。
   */
  const exitedRequestRef = useRef<{ request: number; lastOutput: string | null } | null>(null);

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
  // **選んでいるかどうかで割る。** `desiredRuntime` が在る限り、**初期化が落ちている段と
  // 起動した後でプロセスが終わった段を除いて**どの段でも、利用者から見れば「起動を待っている」。
  // `"no-engine"` の doc（「まだ選んでいない」）とも一致する。
  //
  // **選んでいるかを先に見る。** `error` を先に見ると、壊れたプリセットの選択を外した
  // 直後——`desiredRuntime` が null になってから `phase` が `idle` へ戻るまでの
  // 本物の IPC 往復——に「設定でエンジンのオプションを変えて保存」と案内する。
  // **もう選んでいないプリセット**のオプションを変えろ、という実行できない案内になる。
  const notReadyReason: EngineNotReadyReason = !desiredRuntime
    ? presetIncomplete
      ? "failed"
      : "no-engine"
    : state.phase === "error" && state.error?.kind === "cancelled"
      ? "cancelled"
      : state.phase === "error" || state.phase === "exited" || state.phase === "unresponsive"
        ? "failed"
        : "starting";

  // **合併にしてから配る。** 2つの欄を独立に持たせると、呼び手が
  // `notReadyReason ?? "既定値"` を書くことになり、その既定値が理由を取り違える。
  const readiness: EngineReadiness = useMemo(
    () => (isReady ? { isReady: true, notReadyReason: null } : { isReady: false, notReadyReason }),
    [isReady, notReadyReason],
  );

  // lifecycle
  // **起動中でも撃ってよい。** 前の起動は Rust が落とし（前の呼び出しは `cancelled` で断られる）、
  // その結果は世代（`seqRef`）で捨てる。世代は Rust にも渡し、撃った順と着く順の逆転を Rust が断る
  // （`startAnalysisEngine` の `request`）。起動中に設定が変わった回
  // （`docs/state-transitions/engine.md` の (S1, E3)）がここを通る
  const initialize = useCallback(async (): Promise<void> => {
    if (!desiredRuntime) return;

    const mySeq = nextRequestNumber();
    seqRef.current = mySeq;

    const snap: EngineRuntimeConfig =
      typeof structuredClone === "function"
        ? structuredClone(desiredRuntime)
        : JSON.parse(JSON.stringify(desiredRuntime));

    lastTriedRef.current = snap;
    dispatch({ type: "initialize_start" });

    try {
      const outcome = await engineInitializer.initialize(desiredRuntime, mySeq);
      if (seqRef.current !== mySeq) return;

      dispatch({
        type: "initialize_success",
        payload: {
          engineInfo: outcome.info,
          activeRuntime: snap,
          warnings: outcome.warnings,
        },
      });
      if (exitedRequestRef.current?.request === mySeq) {
        dispatch({ type: "engine_exited", payload: exitedRequestRef.current.lastOutput });
      }
    } catch (e) {
      if (seqRef.current !== mySeq) return;
      dispatch({ type: "initialize_error", payload: asStartFailure(e) });
    }
  }, [desiredRuntime]);

  const shutdown = useCallback(async (): Promise<void> => {
    const mySeq = nextRequestNumber();
    seqRef.current = mySeq;
    try {
      await engineInitializer.shutdown(mySeq);
    } finally {
      // **停止の往復の間に次の起動が撃たれていたら、`idle` を書かない。** 書くと起動中の段が
      // `idle` に落ち、effect の `idle` の枝が同じ設定でもう1回起動する（進行中の起動は捨てられる）
      if (seqRef.current === mySeq) dispatch({ type: "shutdown" });
    }
  }, []);

  const cancelStart = useCallback((): void => {
    const mySeq = nextRequestNumber();
    seqRef.current = mySeq;
    // 失敗として止める。`idle` に戻すと、設定が選ばれたままなので effect が起動し直す
    dispatch({
      type: "initialize_error",
      payload: {
        kind: "cancelled",
        message: "the user stopped the engine start",
        lastOutput: null,
      },
    });
    engineInitializer.shutdown(mySeq).catch((e: unknown) => {
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

  // **番号が最後に撃った起動のものだけ採る。** 起動し直しの窓には古いプロセスの通知が届く。
  // 読み手は `dispatch` と ref だけなので、購読はマウントの1回でよい
  useEffect(() => {
    if (!isTauri()) return;

    let alive = true;
    let unlisten: (() => void) | null = null;
    const current = (request: number) => request === seqRef.current;
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
    // 設定が無い → 止める
    if (!desiredRuntime) {
      if (state.phase !== "idle") {
        shutdown().catch(() => {});
      }
      return;
    }

    // 失敗と終了は「別設定なら」起動し直す。同じ設定のまま自動では起動しない
    if (state.phase === "error" || state.phase === "exited") {
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

    // 起動中に別の設定になった → その設定で起動し直す（前の起動は Rust が落とす）。
    // 同じ値の設定が来ただけなら何もしない
    if (state.phase === "initializing") {
      const last = lastTriedRef.current;
      if (!last || !equalRuntime(desiredRuntime, last)) initialize().catch(() => {});
      return;
    }

    // 起動済みで設定が変わった → 再起動。指示が通らないエンジンは Rust が `quit` を待たずに落とす
    if ((state.phase === "ready" || state.phase === "unresponsive") && state.activeRuntime) {
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
      cancelStart,
      slowStart,
      presetIncomplete,
      reportUnreachable,
    }),
    [state, readiness, initialize, cancelStart, slowStart, presetIncomplete, reportUnreachable],
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
