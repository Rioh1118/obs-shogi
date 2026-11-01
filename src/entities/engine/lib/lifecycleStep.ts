import { equalRuntime } from "./equalRuntime";
import type { EnginePhase, EngineRuntimeConfig } from "../model/types";

/** 選んでいる設定に追いつくために、次に行うこと */
type LifecycleStep = "none" | "start" | "restart" | "shutdown";

type LifecycleInputs = {
  desiredRuntime: EngineRuntimeConfig | null;
  phase: EnginePhase;
  /** 起動済みのプロセスの設定 */
  activeRuntime: EngineRuntimeConfig | null;
  /** 最後に起動を試みた設定 */
  lastTriedRuntime: EngineRuntimeConfig | null;
};

/** `a` が、前に使った設定 `b` と同じ値か。`b` が無ければ別の設定として扱う */
function matches(a: EngineRuntimeConfig, b: EngineRuntimeConfig | null): boolean {
  return b !== null && equalRuntime(a, b);
}

/**
 * いまの段と選んでいる設定から、次に行うことを返す。
 *
 * `error` と `exited` は別の設定になったときだけ起動し、同じ設定では止まったままにする。
 * 繰り返し落ちるエンジンを起動し続けないため。
 * `initializing` は前の起動を待たずに別の設定で起動する。前の起動は Rust が落とす。
 * `unresponsive` のエンジンは Rust が `quit` を待たずに落とす
 */
export function lifecycleStepOf({
  desiredRuntime,
  phase,
  activeRuntime,
  lastTriedRuntime,
}: LifecycleInputs): LifecycleStep {
  if (!desiredRuntime) return phase === "idle" ? "none" : "shutdown";

  switch (phase) {
    case "idle":
      return "start";
    case "initializing":
    case "error":
    case "exited":
      return matches(desiredRuntime, lastTriedRuntime) ? "none" : "start";
    case "ready":
    case "unresponsive":
      return activeRuntime && !equalRuntime(desiredRuntime, activeRuntime) ? "restart" : "none";
  }
}
