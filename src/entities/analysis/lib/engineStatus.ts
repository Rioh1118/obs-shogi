import type { EnginePhase } from "@/entities/engine";
import type { AnalysisState } from "../model/types";

/**
 * 操作列が1語で言う、エンジンの状態。**判定と遷移の出典は
 * `docs/state-transitions/engine-standardization.md`**（記号 V0〜V8 はそちら）。
 */
export type EngineStatus =
  /** V2 `待機中` */
  | "standing-by"
  /** V3 `検討中` */
  | "analyzing"
  /** V5 `検討完了` */
  | "finished"
  /** V6 `応答なし` */
  | "unresponsive"
  /** V7 `エンジン終了` */
  | "exited";

type Inputs = {
  phase: EnginePhase;
  analysis: Pick<AnalysisState, "isAnalyzing" | "finished" | "analyzedSfen">;
  /** 盤の局面 */
  currentSfen: string | null;
};

/**
 * **エンジンの状態を先に見る。** 検討の入り切りはプロセスが終わっても倒れないので
 * （再起動で読み直すため）、こちらを先に見ると終わったエンジンの前に `検討中` が出る。
 *
 * **完了は局面まで見る。** 局面を動かしてから次の探索が始まるまでの間も `検討完了` と言うと、
 * 動かした局面を読み終えたように見える。
 */
export function engineStatusOf({ phase, analysis, currentSfen }: Inputs): EngineStatus {
  if (phase === "exited") return "exited";
  if (phase === "unresponsive") return "unresponsive";
  if (!analysis.isAnalyzing) return "standing-by";
  if (analysis.finished && analysis.analyzedSfen === currentSfen) return "finished";
  return "analyzing";
}
