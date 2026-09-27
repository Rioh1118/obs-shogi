import type { EngineRuntimeConfig } from "../model/types";

/** 利用者の値を**名前で**突き合わせる（並びは見ない。送る順は Rust が申告から決める） */
function sameValues(a: Record<string, string>, b: Record<string, string>) {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * 同じ設定で起こしたことになるか。**違えば起動し直す**（`provider.tsx`）。
 * 評価関数・定跡はパスで比べる（ファイルを変えただけでも起動し直す）
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
