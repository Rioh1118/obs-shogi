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
/** `INITIAL_SFEN` から ▲７六歩 を指した局面。手番は後手。 */
const AFTER_7G7F_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2";

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

/**
 * 出ている候補手の指し手そのもの。
 *
 * **件数では足りない。** 控えと `state.candidates` がどちらも同じ件数を持つ場面では、
 * 件数を見るだけの判定は「控えを一度も読まない実装」を素通しする。
 */
const shownCandidateMoves = (container: HTMLElement) =>
  [...container.querySelectorAll(".candidates-section .move-sequence__move")]
    .map((node) => node.textContent)
    .join("");

/** 初形での候補手。2番手は ▲２六歩。 */
const candidatesAtInitial: AnalysisCandidate[] = [
  { rank: 1, first_move: "7g7f", pv_line: ["7g7f"], depth: 20 },
  { rank: 2, first_move: "2g2f", pv_line: ["2g2f"], depth: 20 },
];

/** ▲７六歩 のあとの局面での候補手。2番手は △３四歩。 */
const candidatesAfter7g7f: AnalysisCandidate[] = [
  { rank: 1, first_move: "8c8d", pv_line: ["8c8d"], depth: 20 },
  { rank: 2, first_move: "3c3d", pv_line: ["3c3d"], depth: 20 },
];

const twoCandidates = candidatesAtInitial;

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
  /**
   * **控えを読んでいることを、`state.candidates` と別の値で固定する。**
   * 停止しても `candidates` は残るので（`stop_analysis` は触らない）、戻ってきた局面の
   * 控えと、いま `state` に載っている候補手が別物になる場面を作る。
   * 停止中の枝を `state.candidates` に差し替える実装はここで落ちる。
   */
  test("戻ってきた局面では、その局面の控えを出す（`state` に残っている候補手ではない）", () => {
    // 初形を解析して止める
    analysis.state.isAnalyzing = true;
    analysis.state.analyzedSfen = INITIAL_SFEN;
    analysis.state.candidates = candidatesAtInitial;
    const view = render(<AnalysisPane />);
    analysis.state.isAnalyzing = false;
    view.rerender(<AnalysisPane />);

    // ▲７六歩 の局面へ進めて解析して止める。`state.candidates` はこちらになる
    game.state.cursor = { tesuuPointer: "1,[]" };
    game.view.currentSfen = AFTER_7G7F_SFEN;
    analysis.state.isAnalyzing = true;
    analysis.state.analyzedSfen = AFTER_7G7F_SFEN;
    analysis.state.candidates = candidatesAfter7g7f;
    view.rerender(<AnalysisPane />);
    analysis.state.isAnalyzing = false;
    view.rerender(<AnalysisPane />);

    // 初形へ戻る。`state.candidates` は ▲７六歩 側のまま
    game.state.cursor = { tesuuPointer: "0,[]" };
    game.view.currentSfen = INITIAL_SFEN;
    view.rerender(<AnalysisPane />);

    expect(shownCandidateMoves(view.container)).toContain("２六歩");
    expect(shownCandidateMoves(view.container)).not.toContain("３四歩");
  });

  /**
   * `scopeTo` の呼び口が消えても気づけるようにする。**鍵に棋譜が入っているので、
   * 別の棋譜へ移るだけでは分からない** —— 戻ってきて、前の控えが引けないことを見る。
   * `fileKey` はツリーの走査ごとに振り直される（#568）ので、同じ棋譜でも宣言し直しは起きる。
   */
  test("棋譜を宣言し直すと、前に宣言していた分は引けない", () => {
    const view = analyzeThenStop();

    fileTree.selectedNode = { id: "file-b" };
    view.rerender(<AnalysisPane />);
    fileTree.selectedNode = { id: "file-a" };
    view.rerender(<AnalysisPane />);

    expect(shownCandidates(view.container)).toBe(0);
  });

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
