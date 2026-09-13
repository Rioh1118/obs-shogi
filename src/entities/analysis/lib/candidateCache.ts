import type { AnalysisCandidate } from "@/entities/engine";

/**
 * 停止中に出す候補手の控え。
 *
 * **画面ではなく entity が持つ。** 解析が止まっている間、画面に出る候補手はここにしか無い
 * （`state.candidates` を直に出すのは解析中だけ）。持ち主を解析ビューにすると、
 * ビューが作り直された回だけ控えが空に戻り、エンジンも盤も何も失っていないのに
 * 画面からだけ候補手が消える。
 *
 * **作り直す側は全て `AnalysisProvider` より下に居る。** 解析ビューを描くのは
 * `pages/AppLayout.tsx` だけで、その上に `RuntimeProviders`（`AnalysisBridge` が
 * `AnalysisProvider` を描く）が在る。だから引き金が何であれ、この控えは巻き込まれない。
 * 引き金はいまのところ境界からの復帰と `hasKifu` の落ち上がり（棋譜を閉じるとビューごと
 * 消える）で、タブ化（ADR-0010 / #562）を入れるとタブ切替が加わる。
 *
 * **provider ごと畳まれる経路は別にある** —— `RequireRootDir` の差し戻し
 * （ワークスペースの切替・設定が読めない回）。そこでは控えも消えるが、
 * 別のワークスペースへ移るのだから消えてよい。
 */
export type CandidateCache = {
  /**
   * 控えの対象とする棋譜を宣言する。前に宣言されたものと違えば控えを全て捨てる。
   *
   * **棋譜を跨いだ持ち越しを断つだけの操作。** 件数の上限にはならない —— 同じ棋譜を
   * 開いたままなら、局面の数 × エンジンの数だけ積まれ、アプリを閉じるまで残る。
   * 取り違えも防がない —— 鍵が指す棋譜・局面と、控えた候補手を出した盤・エンジンが
   * 食い違う経路が別に在る（#568）。ここが受けるのは呼び手が宣言した文字列だけで、
   * 突き合わせる相手を持たない。
   */
  scopeTo(fileKey: string | null): void;
  /**
   * ある鍵の控えを覚える。同じ鍵なら上書きする。
   *
   * **鍵には `scopeTo` で宣言した棋譜の識別子を含めること。** 含めないと、
   * 棋譜を跨いだ当たりが出る。組み立ては `widgets/analysis-pane/ui/AnalysisPane.tsx`
   * の `cacheKey` が持つ（**この型は形を検査しない**）。
   */
  remember(cacheKey: string, candidates: AnalysisCandidate[]): void;
  /** 当たりが無ければ空。`cacheKey` が null（棋譜か局面が定まらない）なら常に空。 */
  lookup(cacheKey: string | null): readonly AnalysisCandidate[];
};

/** 当たりが無いときに返すもの。呼ぶたびに作らないことで参照の同一性を保つ。 */
const EMPTY_CANDIDATES: readonly AnalysisCandidate[] = [];

export function createCandidateCache(): CandidateCache {
  const remembered = new Map<string, AnalysisCandidate[]>();
  let scopedFileKey: string | null = null;

  return {
    scopeTo(fileKey) {
      if (fileKey === scopedFileKey) return;
      scopedFileKey = fileKey;
      remembered.clear();
    },

    remember(cacheKey, candidates) {
      remembered.set(cacheKey, candidates);
    },

    lookup(cacheKey) {
      if (!cacheKey) return EMPTY_CANDIDATES;
      return remembered.get(cacheKey) ?? EMPTY_CANDIDATES;
    },
  };
}
