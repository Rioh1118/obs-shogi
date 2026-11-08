// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Color } from "shogi.js";
import { createCandidateCache } from "@/entities/analysis/lib/candidateCache";
import type { EngineStatus } from "@/entities/analysis";
import type { AnalysisCandidate } from "@/entities/engine";

import StatsSection from "../StatsSection";

/**
 * 検討ペインが候補手から出す数字。評価値、読み筋、評価値バー、脚注。
 *
 * 評価値はエンジンが手番の側から見た値なので、後手番の局面では符号を返して出す。
 * 返し損ねると、後手番の局面だけ形勢が逆に読める。
 * 候補手を出す条件とキャッシュは `analysisPaneCandidateCache.test.tsx` が見る。
 */

/** ▲７六歩 を指した後の局面。手番は後手 */
const AFTER_7G7F_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2";

const analysis = {
  state: {
    isAnalyzing: true,
    analyzedSfen: AFTER_7G7F_SFEN as string | null,
    candidates: [] as AnalysisCandidate[],
  },
  candidateCache: createCandidateCache(),
};
const game = {
  state: { cursor: { tesuuPointer: "1,[]" } },
  view: { currentSfen: AFTER_7G7F_SFEN as string | null, currentTurn: Color.White as Color },
};
const status = { value: "analyzing" as EngineStatus };
const config = { analysis_display_mode: "table", show_evaluation_bar: true };

vi.mock("@/entities/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/analysis")>();
  const mocked = {
    ...actual,
    useAnalysis: (() => analysis) as unknown as typeof actual.useAnalysis,
  };
  return mocked satisfies typeof import("@/entities/analysis");
});
vi.mock("@/widgets/analysis-pane/lib/useEngineStatus", () => {
  const mocked = { useEngineStatus: () => status.value };
  return mocked satisfies typeof import("@/widgets/analysis-pane/lib/useEngineStatus");
});
vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = { ...actual, useGame: (() => game) as unknown as typeof actual.useGame };
  return mocked satisfies typeof import("@/entities/game");
});
vi.mock("@/entities/file-tree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/file-tree")>();
  const mocked = {
    ...actual,
    useFileTree: (() => ({ selectedNode: { id: "f" } })) as unknown as typeof actual.useFileTree,
  };
  return mocked satisfies typeof import("@/entities/file-tree");
});
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => {
  const mocked = {
    useEnginePresets: (() => ({
      state: { selectedPresetId: "p" },
    })) as unknown as typeof import("@/entities/engine-presets/model/useEnginePresets").useEnginePresets,
  };
  return mocked satisfies typeof import("@/entities/engine-presets/model/useEnginePresets");
});
vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => ({ config })) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});

const { default: AnalysisPane } = await import("../AnalysisPane");

const tableRows = () => screen.getAllByRole("row").slice(1);
const cellsOf = (row: HTMLElement) => [...row.querySelectorAll("td")].map((td) => td.textContent);

beforeEach(() => {
  analysis.state = { isAnalyzing: true, analyzedSfen: AFTER_7G7F_SFEN, candidates: [] };
  analysis.candidateCache = createCandidateCache();
  game.view.currentSfen = AFTER_7G7F_SFEN;
  game.view.currentTurn = Color.White;
  status.value = "analyzing";
  config.analysis_display_mode = "table";
  config.show_evaluation_bar = true;
});

afterEach(cleanup);

describe("候補手の表", () => {
  test("後手番の評価値は先手視点へ返して出し、読み筋は日本語の指し手で出す", () => {
    analysis.state.candidates = [
      {
        rank: 1,
        first_move: "8c8d",
        pv_line: ["8c8d", "2g2f"],
        evaluation: { value: 120, kind: "Centipawn" },
      },
    ];
    render(<AnalysisPane />);

    const [row] = tableRows();
    expect(cellsOf(row)[0]).toContain("８四歩");
    expect(cellsOf(row)[1]).toBe("-120");
    expect(cellsOf(row)[2]).toContain("２六歩");
  });

  test("先手番の評価値はそのまま出す", () => {
    game.view.currentTurn = Color.Black;
    game.view.currentSfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
    analysis.state.analyzedSfen = game.view.currentSfen;
    analysis.state.candidates = [
      {
        rank: 1,
        first_move: "7g7f",
        pv_line: ["7g7f"],
        evaluation: { value: 52, kind: "Centipawn" },
      },
    ];
    render(<AnalysisPane />);

    expect(cellsOf(tableRows()[0])[1]).toBe("+52");
  });

  test("読み筋が無ければ最初の手を読み筋にし、どちらも無ければ指し手を — にする", () => {
    analysis.state.candidates = [
      { rank: 1, first_move: "8c8d", pv_line: [] },
      { rank: 2, first_move: null, pv_line: [] },
    ];
    render(<AnalysisPane />);

    const [first, second] = tableRows();
    expect(cellsOf(first)[0]).toContain("８四歩");
    expect(cellsOf(first)[1]).toBe("---");
    expect(cellsOf(second)[0]).toBe("—");
  });

  test("押した行を選び、その行が消えたらどの行も選ばない", () => {
    analysis.state.candidates = [
      { rank: 1, first_move: "8c8d", pv_line: ["8c8d"] },
      { rank: 2, first_move: "3c3d", pv_line: ["3c3d"] },
    ];
    const view = render(<AnalysisPane />);

    fireEvent.click(tableRows()[1]);
    expect(tableRows().map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "true"]);

    // 本番の reducer と同じく、新しい state を渡す。同じオブジェクトを書き換えると memo が古い行を返す
    analysis.state = {
      ...analysis.state,
      candidates: [{ rank: 1, first_move: "8c8d", pv_line: ["8c8d"] }],
    };
    view.rerender(<AnalysisPane />);
    expect(tableRows().map((row) => row.getAttribute("aria-selected"))).toEqual(["false"]);
  });

  test("最善の行に印を付ける", () => {
    analysis.state.candidates = [
      { rank: 2, first_move: "3c3d", pv_line: ["3c3d"] },
      { rank: 1, first_move: "8c8d", pv_line: ["8c8d"] },
    ];
    render(<AnalysisPane />);

    const best = tableRows().filter((row) => row.classList.contains("candidate-table__row--best"));
    expect(best).toHaveLength(1);
    expect(cellsOf(best[0])[0]).toContain("８四歩");
  });
});

describe("候補手の行", () => {
  test("行のモードでも、評価値を先手視点で出す", () => {
    config.analysis_display_mode = "rows";
    analysis.state.candidates = [
      {
        rank: 1,
        first_move: "8c8d",
        pv_line: ["8c8d"],
        evaluation: { value: 120, kind: "Centipawn" },
      },
    ];
    render(<AnalysisPane />);

    expect(screen.getByText("-120")).toBeTruthy();
  });
});

describe("評価値バー", () => {
  test("最善手の評価値を先手視点で置く", () => {
    analysis.state.candidates = [
      {
        rank: 1,
        first_move: "8c8d",
        pv_line: ["8c8d"],
        evaluation: { value: 1500, kind: "Centipawn" },
      },
    ];
    const { container } = render(<AnalysisPane />);

    const black = container.querySelector<HTMLElement>(".evaluation-bar__side--black")!;
    const white = container.querySelector<HTMLElement>(".evaluation-bar__side--white")!;
    expect(black.style.width).toBe("25%");
    expect(white.style.width).toBe("75%");
  });

  test("バーに置くのは1行目ではなく最善手の評価値", () => {
    analysis.state.candidates = [
      {
        rank: 1,
        first_move: "8c8d",
        pv_line: ["8c8d"],
        evaluation: { value: 1500, kind: "Centipawn" },
      },
      {
        rank: 2,
        first_move: "3c3d",
        pv_line: ["3c3d"],
        evaluation: { value: -1500, kind: "Centipawn" },
      },
    ];
    const { container } = render(<AnalysisPane />);

    const black = container.querySelector<HTMLElement>(".evaluation-bar__side--black")!;
    expect(black.style.width).toBe("25%");
  });

  test("エンジンが止まった後の候補手から導いたバーは、古いものとして出す", () => {
    status.value = "exited";
    analysis.state.isAnalyzing = false;
    analysis.state.candidates = [
      {
        rank: 1,
        first_move: "8c8d",
        pv_line: ["8c8d"],
        evaluation: { value: 0, kind: "Centipawn" },
      },
    ];
    const { container } = render(<AnalysisPane />);

    expect(container.querySelector(".analysis-pane__gauge.analysis-pane--stale")).not.toBeNull();
    expect(container.querySelector(".analysis-pane__body.analysis-pane--stale")).not.toBeNull();
  });
});

describe("脚注", () => {
  const values = (container: HTMLElement) =>
    [...container.querySelectorAll(".stats-section__item")].map((item) => item.textContent);

  test("最善手の探索の数を出す", () => {
    analysis.state.candidates = [
      { rank: 2, first_move: "3c3d", pv_line: ["3c3d"], depth: 1, nodes: 1, time_ms: 1 },
      {
        rank: 1,
        first_move: "8c8d",
        pv_line: ["8c8d"],
        depth: 20,
        nodes: 1_234_567,
        time_ms: 2500,
      },
    ];
    const { container } = render(<AnalysisPane />);

    expect(values(container)).toEqual(["深さ20", "ノード数1.2M", "NPS493.8K", "時間2.5s"]);
  });

  test("最善手が先頭に無くても、最善手の数を出す", () => {
    analysis.state.candidates = [
      { rank: 1, first_move: "8c8d", pv_line: ["8c8d"], depth: 20, nodes: 1000, time_ms: 1000 },
      { rank: 2, first_move: "3c3d", pv_line: ["3c3d"], depth: 1, nodes: 1, time_ms: 1 },
    ];
    const { container } = render(<AnalysisPane />);

    expect(values(container)[0]).toBe("深さ20");
  });

  test.each([
    [{ depth: 0, nodes: 0, time_ms: 0 }, ["深さ0", "ノード数0", "NPS—", "時間0.0s"]],
    [{ depth: 3, nodes: 999, time_ms: 75_000 }, ["深さ3", "ノード数999", "NPS13", "時間1:15"]],
    [{ depth: null, nodes: 1500, time_ms: null }, ["深さ—", "ノード数1.5K", "NPS—", "時間—"]],
    [null, ["深さ—", "ノード数—", "NPS—", "時間—"]],
  ])("%j の欄は4つとも出す", (searchStats, expected) => {
    const { container } = render(<StatsSection searchStats={searchStats} />);

    expect(values(container)).toEqual(expected);
  });
});
