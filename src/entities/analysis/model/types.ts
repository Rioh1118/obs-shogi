import type { AnalysisCandidate, AnalysisResult } from "@/entities/engine";

export interface AnalysisState {
  isAnalyzing: boolean;
  currentPosition: string | null; // SFEN
  candidates: AnalysisCandidate[];
  error: string | null;
}

export type AnalysisAction =
  | { type: "start_analysis"; payload: { position: string } }
  | { type: "stop_analysis" }
  | { type: "update_result"; payload: AnalysisResult }
  | { type: "set_error"; payload: string }
  | { type: "clear_results" };

/** エンジンへの局面同期を解析側へ注入するための面。実装は features 側にある。 */
export type PositionSyncAdapter = {
  /** 盤が指している局面の SFEN。棋譜を開いていなければ null。 */
  currentSfen: string | null;
  /**
   * 最後にエンジンへ送れた SFEN。
   * エンジンの切替・再起動と、棋譜を閉じたときに null に戻る。
   */
  syncedSfen: string | null;
  /**
   * 現在の局面をエンジンへ送る。送信に失敗すると reject する。
   *
   * **resolve は送れたことを意味しない。** エンジンが未 ready のときと棋譜を開いていない
   * ときは何も送らずに resolve する。送れたかどうかは `syncedSfen` で判定すること。
   * `syncedSfen` の反映は resolve と同じレンダではない。
   */
  syncPosition: () => Promise<void>;
};

/**
 * 解析ペインが使う面。**ここに載せるのは、スライスの外に呼び手が居るものだけ。**
 *
 * 呼び手0の口を載せると、次に触る人が「その口が正しい入口だ」と読む。
 * 候補手を取り出すのは `lib` の `pickTopCandidate`（`state.candidates` を渡す）。
 */
export interface AnalysisContextType {
  state: AnalysisState;

  startInfiniteAnalysis: () => Promise<void>;
  stopAnalysis: () => Promise<void>;
}
