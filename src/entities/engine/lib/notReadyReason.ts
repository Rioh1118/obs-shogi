import { equalRuntime } from "./equalRuntime";
import type { EngineNotReadyReason, EnginePhase, EngineRuntimeConfig } from "../model/types";

/**
 * `phase: "error"` から**起動し直す口が在るか**。
 *
 * **綴りを1つにする。** 同じ判断を「理由を決める側」と「起動し直す effect」の両方が使うので、
 * 書き下ろすと片方だけが古くなる。**引数は名前で受ける**——どちらも同じ型の nullable で、
 * 取り違えても tsc が通り、しかも差が出るのは `lastTried` が無い1点だけ。
 *
 * **前回試した値が無い回は起動し直す**（`error` へ入る口は初期化の失敗だけなので、
 * いまその組み合わせは作れない。口が増えたときに両側が同じ側へ倒れるようにしてある）。
 */
export function retriesAfterError({
  desired,
  lastTried,
}: {
  desired: EngineRuntimeConfig | null;
  lastTried: EngineRuntimeConfig | null;
}): boolean {
  if (!desired) return false;
  return !lastTried || !equalRuntime(desired, lastTried);
}

/**
 * `isReady` が false の理由を `phase` から決める。**`desiredRuntime` が在る回だけ。**
 *
 * **`switch` で網羅する。** 既定へ落とすと、`phase` を1つ足した人の窓が黙って
 * 「待てば戻る」側へ倒れ、**解析が誰にも断たれないまま回り続ける**（→ #502）。
 * どちらへ倒すかは、その phase から起動し直す口が在るかで決める
 * （判断の全体は `docs/state-transitions/engine.md` の ※7）。
 */
export function reasonForPhase(
  phase: EnginePhase,
  willRetryAfterError: boolean,
): EngineNotReadyReason {
  switch (phase) {
    case "idle":
    case "initializing":
    case "ready":
      return "starting";
    case "error":
      return willRetryAfterError ? "starting" : "failed";
  }
}
