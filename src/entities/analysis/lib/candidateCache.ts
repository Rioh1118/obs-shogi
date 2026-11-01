import type { AnalysisCandidate } from "@/entities/engine";

/**
 * 停止中に出す候補手の控え
 *
 * 解析が止まっている間、画面に出る候補手はここにしか無い（`state.candidates` を直に出すのは解析中だけ）。
 * 持ち主を解析ビューにすると、ビューを作り直したときに控えが空に戻り、何も失っていないのに
 * 候補手が消える。
 *
 * ビューを作り直す引き金は全て `AnalysisProvider` より下で起きる。ビューは `pages/AppLayout.tsx` の
 * `Dock` の中に描かれ、`RuntimeProviders` がその上で `AnalysisProvider` を描く。
 *
 * provider ごとアンマウントするのは `RequireRootDir` の差し戻しで、控えも消える。
 * 別のワークスペースへ移るので消えてよい。
 */
export type CandidateCache = {
  /**
   * 控えの対象とする棋譜を宣言する。前に宣言されたものと違えば控えを全て捨てる。
   *
   * 棋譜を跨いだ持ち越しを断つだけで、件数の上限にはならない。同じ棋譜を開いたままなら、
   * 局面の数 × エンジンの数だけ積まれ、アプリを閉じるまで残る。取り違えも防がない。
   * 受けるのは宣言された文字列だけで、控えを出した盤とエンジンを突き合わせる相手を持たない。
   */
  scopeTo(fileKey: string | null): void;
  /**
   * ある鍵の控えを覚える。同じ鍵なら上書きする。
   *
   * **鍵には `scopeTo` で宣言した棋譜の識別子を含めること。** 含めないと棋譜を跨いだ当たりが出る。
   * 形は検査しない。組み立ては `widgets/analysis-pane/ui/AnalysisPane.tsx` の `cacheKey` が持つ。
   */
  remember(cacheKey: string, candidates: AnalysisCandidate[]): void;
  /** 控えを返す。当たりが無いときと、`cacheKey` が null（棋譜か局面が定まらない）のときは空。 */
  lookup(cacheKey: string | null): readonly AnalysisCandidate[];
};

/** 当たりが無いときに返す値。呼ぶたびに作らず、参照の同一性を保つ */
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
