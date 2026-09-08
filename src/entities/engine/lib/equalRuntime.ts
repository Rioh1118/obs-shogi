import type { EngineRuntimeConfig } from "../model/types";

export function shallowEqualOptions(a: Record<string, string>, b: Record<string, string>) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export function equalRuntime(a: EngineRuntimeConfig, b: EngineRuntimeConfig) {
  return (
    a.enginePath === b.enginePath &&
    a.workDir === b.workDir &&
    a.evalDir === b.evalDir &&
    a.bookDir === b.bookDir &&
    a.bookFile === b.bookFile &&
    shallowEqualOptions(a.options, b.options)
  );
}

/**
 * `phase: "error"` から**起動し直す口が在るか**。
 *
 * **綴りを1つにする。** 同じ判断を「理由を決める三項」と「起動し直す effect」の両方が
 * 使うので、書き下ろすと片方だけが古くなる——**その形は実際に1度入っている**
 * （`lastTried` が null の回で、effect は起動し直すのに理由は終端を名乗った）。
 *
 * **前回試した値が無い回は起動し直す。** そこは「同じ設定で落ちた」に当たらない。
 */
export function retriesAfterError(
  desired: EngineRuntimeConfig | null,
  lastTried: EngineRuntimeConfig | null,
): boolean {
  if (!desired) return false;
  return !lastTried || !equalRuntime(desired, lastTried);
}
