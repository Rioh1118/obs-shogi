import type { AnalysisCandidate, AnalysisResult } from "@/entities/engine";
import type { CandidateCache } from "../lib/candidateCache";

export type AnalysisState = {
  /**
   * 検討の意思。エンジンが動いているかではない。再起動を跨いで残り、戻ったら読み直す。
   * 立つ条件と下りる条件は `docs/state-transitions/engine-standardization.md`
   */
  isAnalyzing: boolean;
  /** いま解析している局面。席を握った時点の盤で、盤の現在位置とは限らない */
  analyzedSfen: string | null;
  /**
   * `analyzedSfen` の探索をエンジンが自分で終えた。`isAnalyzing` は倒さず、局面が動けば読み始める
   * （`engine-standardization.md` の V5）
   */
  finished: boolean;
  /** ■ を押してから、エンジンが止まるまで。この間 ■ は押せない（V4） */
  stopping: boolean;
  /**
   * ▶ を押してから席が返るまで。語はこの間も `検討中`（V3）。
   * `isAnalyzing` を立てると自動再開の effect が動いて ▶ と席を取り合うので、別に持つ
   */
  starting: boolean;
  candidates: AnalysisCandidate[];
  error: string | null;
};

export type AnalysisAction =
  | { type: "start_analysis"; payload: { sfen: string } }
  | { type: "hold_intent" }
  | { type: "begin_start" }
  | { type: "end_start" }
  | { type: "begin_stop" }
  | { type: "engine_restored" }
  | { type: "stop_analysis" }
  | { type: "finish_analysis"; payload: AnalysisResult }
  | { type: "update_result"; payload: AnalysisResult }
  | { type: "set_error"; payload: string }
  | { type: "clear_results" };

/** エンジンへの局面の同期を解析へ渡す面。実装は `features/engine-position-sync` が持つ */
export type PositionSyncAdapter = {
  /** 盤が指している局面の SFEN。棋譜を開いていなければ null */
  currentSfen: string | null;
  /**
   * 最後にエンジンへ送れた SFEN。エンジンの切替、再起動、棋譜を閉じたときに null に戻る
   */
  syncedSfen: string | null;
  /**
   * 現在の局面をエンジンへ送る。送信に失敗すると reject する。
   *
   * **resolve は送れたことを意味しない。** エンジンが未 ready のときと棋譜を開いていないときは
   * 何も送らずに resolve する。送れたかは `syncedSfen` で判定すること。
   * `syncedSfen` の反映は resolve と同じ描画ではない。
   */
  syncPosition: () => Promise<void>;
};

/**
 * 解析ペインが使う面
 *
 * 載せるのはスライスの外に呼び手が居るものだけ（`index.ts`）。
 *
 * `clear_results` が届くのは `state` の中だけで、`candidateCache` には届かない。
 * 控えを捨てる関数は控えの側（`scopeTo`）にある。
 */
export type AnalysisContextType = {
  state: AnalysisState;

  /**
   * 停止中に出す候補手の控え。持ち主と寿命は `lib/candidateCache.ts`。
   *
   * `state` には載せない。控えは表示を駆動する値ではなく、結果を捨てても停止中に見えていた
   * 候補手は見えたままでよいので、`clear_results` の対象にしない。
   */
  candidateCache: CandidateCache;

  /**
   * ▶ の操作。エンジンの起動を待っているときは断らず、検討の意思を立てて resolve する。
   *
   * 断るときは `state.error` に載せてから reject し、帯（`AnalysisRefusalBridge`）が文を出す
   * （枝と文言は `docs/state-transitions/analysis.md` の ※15）。読む局面が無いときだけは断りを立てずに
   * reject する。▶ が `disabled` なので出す先が無い。
   *
   * アンマウント、停止、読む局面の消失で要らなくなった要求は、静かに resolve する。
   */
  startInfiniteAnalysis: () => Promise<void>;
  /**
   * ■ の操作。検討は必ず切れる。停止が Rust に届かなければ、エンジンを `応答なし` にして
   * reject する（`analysis.md` の ※7、F-7）。復帰は再起動
   */
  stopAnalysis: () => Promise<void>;
};
