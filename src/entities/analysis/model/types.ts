import type { AnalysisCandidate, AnalysisResult } from "@/entities/engine";

export interface AnalysisState {
  isAnalyzing: boolean;
  /** いま解析している局面。**席を握った時点の盤**で、盤の現在位置とは限らない。 */
  analyzedSfen: string | null;
  candidates: AnalysisCandidate[];
  error: string | null;
}

export type AnalysisAction =
  | { type: "start_analysis"; payload: { sfen: string } }
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
 * 候補手を取り出すのは `lib` の `pickTopCandidate`（盤の向きを直してから渡すこと）。
 *
 * **`state` の外に出た結果を、この provider は無効化できない。** 停止中に何を出すかは
 * 画面側が決めてよいが、`clear_results` が届くのは `state` の中だけ——画面が
 * 自前の控えを持つなら、その寿命も画面側の責任になる。
 */
export interface AnalysisContextType {
  state: AnalysisState;

  /**
   * ▶。**断りを立てた回は `state.error` に載せてから reject する**（枝と文言は
   * `docs/state-transitions/analysis.md` の ※15。ここでは数え上げない）。
   * **読む局面が無い回だけは断りを立てずに reject する**——その状態では ▶ が
   * `disabled` なので、画面に出す先が無い。
   * **その断りの読み手はまだ0**（→ #277）ので、いまは呼び手の `console.error` で終わる。
   *
   * **要らなくなった要求は静かに resolve する**——畳まれた・止められた・読む局面が
   * 無くなった回。その失敗を出しても、出す先の画面がもう無いか、利用者が既に降りている。
   */
  startInfiniteAnalysis: () => Promise<void>;
  /**
   * ■。**表示は必ず停止中になる**（`finally` で state を落とす）。
   * **ただし停止が Rust に届かなかった回は、断りを立てて reject する**
   * （`STOP_FAILED_MESSAGE`）——席が残ることがある（→ ※7 / F-7）。その回の復帰は ▶。
   */
  stopAnalysis: () => Promise<void>;
}
