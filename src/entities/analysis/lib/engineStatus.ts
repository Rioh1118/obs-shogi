import type { EngineNotReadyReason, EnginePhase, EngineStartFailureKind } from "@/entities/engine";
import type { AnalysisState } from "../model/types";

/**
 * 操作列が1語で言う、エンジンの状態。**判定と遷移の出典は
 * `docs/state-transitions/engine-standardization.md`**（記号 V0〜V8 はそちら）。
 */
export type EngineStatus =
  /** V1 `起動中…` */
  | "starting"
  /** V2 `待機中` */
  | "standing-by"
  /** V3 `検討中`。V4（止め待ち）も語は同じ */
  | "analyzing"
  /** V5 `検討完了` */
  | "finished"
  /** V6 `応答なし` */
  | "unresponsive"
  /** V7 `エンジン終了` */
  | "exited"
  /** V8 `起動失敗` */
  | "failed"
  /** V8 `起動を中止しました` */
  | "cancelled";

type Inputs = {
  phase: EnginePhase;
  /** `isReady` なら `null` */
  notReadyReason: EngineNotReadyReason | null;
  /** 起動の失敗の種類。`phase === "error"` のときだけ非 null */
  failureKind: EngineStartFailureKind | null;
  analysis: Pick<AnalysisState, "isAnalyzing" | "finished" | "analyzedSfen">;
  /** 盤の局面 */
  currentSfen: string | null;
};

/**
 * **エンジンの状態を先に見る。** 検討の入り切りはエンジンが動いていなくても倒れないので
 * （戻ったら読み直すため）、こちらを先に見ると動いていないエンジンの前に `検討中` が出る。
 *
 * **完了は局面まで見る。** 局面を動かしてから次の探索が始まるまでの間も `検討完了` と言うと、
 * 動かした局面を読み終えたように見える。
 */
export function engineStatusOf({
  phase,
  notReadyReason,
  failureKind,
  analysis,
  currentSfen,
}: Inputs): EngineStatus {
  if (phase === "exited") return "exited";
  if (phase === "unresponsive") return "unresponsive";
  if (phase === "error") return failureKind === "cancelled" ? "cancelled" : "failed";
  if (notReadyReason === "starting") return "starting";
  if (!analysis.isAnalyzing) return "standing-by";
  if (analysis.finished && analysis.analyzedSfen === currentSfen) return "finished";
  return "analyzing";
}
