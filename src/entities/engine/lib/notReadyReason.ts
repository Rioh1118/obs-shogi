import type { EngineStartFailureKind } from "./engineFailure";
import type { EngineNotReadyReason, EnginePhase } from "../model/types";

type NotReadyInputs = {
  /** `desiredRuntime` が在るか */
  chosen: boolean;
  presetIncomplete: boolean;
  phase: EnginePhase;
  failureKind: EngineStartFailureKind | null;
};

/**
 * エンジンを使えない理由を返す。
 *
 * 選んでいるかを `phase` より先に見る。先に `error` を見ると、壊れたプリセットの選択を外した
 * 直後に、選んでいないプリセットのオプションを変えるよう案内してしまう。
 * `desiredRuntime` が `null` になってから `phase` が `idle` へ戻るまでには IPC の往復がある。
 *
 * 選んでいて `error`、`exited`、`unresponsive` でなければ全部 `starting` にする。
 * 起こし直しは `ready → idle → initializing` を通り、その `idle` も画面に出るので、
 * `idle` を `no-engine` に読むと「エンジンを選んでください」が出る
 */
export function notReadyReasonOf({
  chosen,
  presetIncomplete,
  phase,
  failureKind,
}: NotReadyInputs): EngineNotReadyReason {
  if (!chosen) return presetIncomplete ? "failed" : "no-engine";
  if (phase === "error" && failureKind === "cancelled") return "cancelled";
  if (phase === "error" || phase === "exited" || phase === "unresponsive") return "failed";
  return "starting";
}
