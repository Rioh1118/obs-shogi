import type { AnalysisCandidate, AnalysisResult } from "@/entities/engine";

export interface AnalysisState {
  isAnalyzing: boolean;
  sessionId: string | null;
  currentPosition: string | null; // SFEN
  analysisResults: AnalysisResult[];
  candidates: AnalysisCandidate[];
  error: string | null;
}

export type AnalysisAction =
  | { type: "start_analysis"; payload: { sessionId: string; position: string } }
  | { type: "stop_analysis" }
  | { type: "update_result"; payload: AnalysisResult }
  | { type: "set_error"; payload: string }
  | { type: "clear_error" }
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

export interface AnalysisContextType {
  state: AnalysisState;

  startInfiniteAnalysis: () => Promise<void>;
  stopAnalysis: () => Promise<void>;
  clearResults: () => void;
  clearError: () => void;

  getTopCandidate: () => AnalysisCandidate | null;
  getAllCandidates: () => AnalysisCandidate[];
}
