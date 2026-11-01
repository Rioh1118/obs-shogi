import type { EngineRuntimeConfig } from "../model/types";

/** 利用者の値を名前で突き合わせる。送る順は Rust が申告から決めるので、並びは見ない */
function sameValues(a: Record<string, string>, b: Record<string, string>) {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * 同じ設定で起動したことになるか。違えば起動し直す（`lifecycleStepOf`）。
 * 評価関数と定跡はパスで比べるので、ファイルを変えただけでも起動し直す
 */
export function equalRuntime(a: EngineRuntimeConfig, b: EngineRuntimeConfig) {
  return (
    a.enginePath === b.enginePath &&
    a.evalPath === b.evalPath &&
    a.book?.path === b.book?.path &&
    a.book?.useInAnalysis === b.book?.useInAnalysis &&
    sameValues(a.values, b.values)
  );
}
