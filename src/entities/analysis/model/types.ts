import type { AnalysisCandidate, AnalysisResult } from "@/entities/engine/api/rust-types";

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

export type PositionSyncAdapter = {
  currentSfen: string | null;
  syncedSfen: string | null;
  syncPosition: () => Promise<void>;
};

export interface AnalysisContextType {
  state: AnalysisState;

  /**
   * preset の analysisDefaults に従って解析を開始する。
   * mode/閾値の選択は preset 側に集約される。
   */
  startAnalysis: () => Promise<void>;
  /** 後方互換 alias。内部で `startAnalysis()` に転送する。 */
  startInfiniteAnalysis: () => Promise<void>;
  stopAnalysis: () => Promise<void>;
  clearResults: () => void;
  clearError: () => void;

  getTopCandidate: () => AnalysisCandidate | null;
  getAllCandidates: () => AnalysisCandidate[];
}
