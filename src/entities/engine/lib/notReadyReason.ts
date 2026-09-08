import { equalRuntime } from "./equalRuntime";
import {
  RECOVERABLE_NOT_READY_REASONS,
  type EngineNotReadyReason,
  type EnginePhase,
  type PhaseNotReadyReason,
  type EngineRuntimeConfig,
  type RecoverableNotReadyReason,
} from "../model/types";

/**
 * `phase: "error"` から**起動し直す口が在るか**。
 *
 * **綴りを1つにする。** 同じ判断を「理由を決める側」と「起動し直す effect」の両方が使うので、
 * 書き下ろすと片方だけが古くなる。**引数は名前で受ける**——どちらも同じ型の nullable なので
 * 取り違えても tsc が通る。反転するのは**片方だけが `null` の2通り**で、
 * `equalRuntime` が対称なぶん両方が非 null の回は1ビットも変わらない。
 * いま観測差が出ないのは**呼び手が `desiredRuntime` の有無を先に見ているから**で、
 * この関数が対称だからではない。
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
): PhaseNotReadyReason {
  switch (phase) {
    case "idle":
    case "initializing":
    case "ready":
      return "starting";
    case "error":
      return willRetryAfterError ? "starting" : "failed";
  }
}

/**
 * 待てば戻るか。**`false` に絞り込むので、呼び手は終端の理由だけを扱える。**
 *
 * 集合そのもの（`RECOVERABLE_NOT_READY_REASONS`）は `Exclude` の導出元なので
 * `model/types.ts` に残る。**述語はこのファイルに集める**——理由の割り方を
 * 3本とも1箇所で読めるようにするため。
 */
export const isRecoverableNotReady = (
  reason: EngineNotReadyReason,
): reason is RecoverableNotReadyReason =>
  (RECOVERABLE_NOT_READY_REASONS as readonly EngineNotReadyReason[]).includes(reason);
