// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Color } from "shogi.js";

// **barrel を通さない。** 控えを作る口には**スライスの外から**の本番の呼び手が
// 居ない（呼ぶのは `entities/analysis` の provider だけ）ので、載せると
// `scripts/knip-ratchet.sh` の到達しない export が1つ増える。載せていない実体への
// 深い import は `src/__tests__/sliceBarrels.test.ts` が許している。
import { createCandidateCache } from "@/entities/analysis/lib/candidateCache";
import type { AnalysisCandidate } from "@/entities/engine";

/**
 * **停止中に出る候補手の控えを、この画面は持たない。**
 *
 * この画面はドックの `AppErrorBoundary` の内側にあり、そこからの復帰で作り直される
 * （タブ化（ADR-0010 / #562）を入れるとタブ切替でも作り直される。経路の一覧は
 * `entities/analysis/lib/candidateCache.ts`）。保存場所をこの画面に置くと、
 * 作り直された回だけ控えが空に戻る —— エンジンの席も `state.candidates` も
 * 何も失っていないのに、画面からだけ候補手が消える（#561）。
 *
 * ここが見るのは「控えが画面より長生きする置き場から来ている」まで。
 * 実際に `AnalysisProvider` がそういう置き場を持つことは
 * `entities/analysis/model/__tests__/provider.test.tsx` が、控えそのものの振る舞いは
 * `entities/analysis/lib/__tests__/candidateCache.test.ts` が見る。
 *
 * 控えは**テストの側で作って持ち回す**。画面の外に置かれていれば作り直しを跨いで
 * 残る、という関係がそのまま写るため。
 */

const INITIAL_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const analysis = {
  state: {
    isAnalyzing: false,
    analyzedSfen: null as string | null,
    candidates: [] as AnalysisCandidate[],
  },
  candidateCache: createCandidateCache(),
};

const game = {
  getCurrentTurn: () => Color.Black,
  state: { cursor: { tesuuPointer: "0,[]" } as { tesuuPointer: string } | null },
  view: { currentSfen: INITIAL_SFEN as string | null },
};

const fileTree = { selectedNode: { id: "file-a" } as { id: string } | null };
const presets = { state: { selectedPresetId: "preset-a" as string | null } };

vi.mock("@/entities/analysis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/analysis")>()),
  useAnalysis: () => analysis,
}));
vi.mock("@/entities/game", () => ({ useGame: () => game }));
vi.mock("@/entities/file-tree", () => ({ useFileTree: () => fileTree }));
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => ({
  useEnginePresets: () => presets,
}));
// ヘッダは `useURLParams` / `useStudyPositions` / `useBoardOrientation` を引く。
// 控えの経路には関係しない。
vi.mock("../AnalysisPaneHeader", () => ({ default: () => null }));

const { default: AnalysisPane } = await import("../AnalysisPane");

/** 出ている候補手（最善手を除いた分）の数。0 なら「候補手なし」が出る。 */
const shownCandidates = (container: HTMLElement) =>
  container.querySelectorAll(".candidates-section .move-sequence").length;

const twoCandidates: AnalysisCandidate[] = [
  { rank: 1, first_move: "7g7f", pv_line: ["7g7f"], depth: 20 },
  { rank: 2, first_move: "2g2f", pv_line: ["2g2f"], depth: 20 },
];

beforeEach(() => {
  analysis.state.isAnalyzing = false;
  analysis.state.analyzedSfen = null;
  analysis.state.candidates = [];
  game.state.cursor = { tesuuPointer: "0,[]" };
  game.view.currentSfen = INITIAL_SFEN;
  fileTree.selectedNode = { id: "file-a" };
  presets.state.selectedPresetId = "preset-a";
  // **`scopeTo` で初期化しない。** 控えの隔離をそちらに負わせると、`scopeTo` の意味を
  // 変えた回に無関係なテストが赤くなる。作り直しを跨ぐ関係を見る本だけが持ち回す。
  analysis.candidateCache = createCandidateCache();
});

afterEach(() => cleanup());

/**
 * 解析を回して止める。控えはここで書かれる。
 *
 * **`candidates` を空にしない。** `stop_analysis` は `isAnalyzing` と席だけを落とし、
 * `candidates` と `analyzedSfen` を残す（`entities/analysis/model/reducer.ts`）。
 * 空にするとアプリに無い状態を試すことになる。
 */
function analyzeThenStop() {
  analysis.state.isAnalyzing = true;
  analysis.state.analyzedSfen = INITIAL_SFEN;
  analysis.state.candidates = twoCandidates;
  const view = render(<AnalysisPane />);

  analysis.state.isAnalyzing = false;
  view.rerender(<AnalysisPane />);

  return view;
}

describe("解析ペインの候補手の控え", () => {
  test("解析を止めても、直前に届いていた候補手が残る", () => {
    const view = analyzeThenStop();

    expect(shownCandidates(view.container)).toBe(1);
  });

  test("停止中に畳まれて作り直されても、直前に見えていた候補手が出る", () => {
    analyzeThenStop().unmount();

    const again = render(<AnalysisPane />);

    expect(shownCandidates(again.container)).toBe(1);
  });

  /**
   * **破棄そのものは見ていない。** 鍵に棋譜が入っているので、捨てても捨てなくても
   * 別の棋譜の鍵は外れる（`scopeTo` を潰す変異でこの本は緑のまま通る）。
   * 破棄は `entities/analysis/lib/__tests__/candidateCache.test.ts` が見る。
   */
  test("別の棋譜の鍵では控えが出ない", () => {
    const view = analyzeThenStop();

    fileTree.selectedNode = { id: "file-b" };
    view.rerender(<AnalysisPane />);

    expect(shownCandidates(view.container)).toBe(0);
    expect(view.container.querySelector(".candidates-section__empty")).not.toBeNull();
  });

  /**
   * エンジンが読んでいる局面が盤と離れている間に控えると、鍵が指す局面とは別の局面の
   * 候補手が、停止したあとその局面の結果として出る。
   */
  test("エンジンが別の局面を読んでいる間は控えない", () => {
    analysis.state.isAnalyzing = true;
    analysis.state.analyzedSfen = "9/9/9/9/9/9/9/9/9 b - 1";
    analysis.state.candidates = twoCandidates;
    const view = render(<AnalysisPane />);

    analysis.state.isAnalyzing = false;
    view.rerender(<AnalysisPane />);

    expect(shownCandidates(view.container)).toBe(0);
  });

  /**
   * 同じ局面で開いている棋譜だけが替わる場合（どちらも初形など）、エンジンが読んでいる
   * のはその局面なので控えてよい。**捨てる側と控える側が同じレンダで走る**ので、
   * 順序が逆だと控えた直後に捨てることになる。
   */
  test("解析中に棋譜が替わっても、同じ局面なら新しい棋譜の控えとして残る", () => {
    analysis.state.isAnalyzing = true;
    analysis.state.analyzedSfen = INITIAL_SFEN;
    analysis.state.candidates = twoCandidates;
    const view = render(<AnalysisPane />);

    fileTree.selectedNode = { id: "file-b" };
    view.rerender(<AnalysisPane />);

    analysis.state.isAnalyzing = false;
    view.rerender(<AnalysisPane />);

    expect(shownCandidates(view.container)).toBe(1);
  });

  test("局面を動かすと、その局面の控えだけを出す", () => {
    const view = analyzeThenStop();

    game.state.cursor = { tesuuPointer: "1,[]" };
    view.rerender(<AnalysisPane />);

    expect(shownCandidates(view.container)).toBe(0);
  });
});
