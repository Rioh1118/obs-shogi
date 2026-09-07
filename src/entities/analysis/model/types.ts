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
 * 解析ペインが使う面。**載せるのは、スライスの外に呼び手が居るものだけ**
 * ——規約と理由は `index.ts` に1つ置いてある（公開面は context だけではない）。
 *
 * 候補手を取り出すのは `lib` の `pickTopCandidate`。**渡すのは `state.candidates`
 * とは限らない**——解析中はそれ、停止中はペインが持つキャッシュで、どちらも
 * 盤の向きを直してから渡す（`widgets/analysis-pane` の `AnalysisPane`）。
 */
export interface AnalysisContextType {
  state: AnalysisState;

  /**
   * ▶。**失敗したら `state.error` に断りを立てて reject する**（枝と文言は
   * `docs/state-transitions/analysis.md` の ※15。ここでは数え上げない）。
   * **その断りの読み手はまだ0**（→ #277）ので、いまは呼び手の `console.error` で終わる。
   *
   * **要らなくなった要求は静かに resolve する**——畳まれた・止められた・読む局面が
   * 無くなった回。その失敗を出しても、出す先の画面がもう無いか、利用者が既に降りている。
   */
  startInfiniteAnalysis: () => Promise<void>;
  /**
   * ■。**表示は必ず停止中になる**（`finally` で state を落とす）。
   * **ただし停止が Rust に届かなかった回は reject する**——席が残ることがある
   * （→ ※7 / F-7）。その回の復帰は ▶。
   */
  stopAnalysis: () => Promise<void>;
}
