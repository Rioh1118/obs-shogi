// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Color } from "shogi.js";
import { createCandidateCache } from "@/entities/analysis/lib/candidateCache";
import type { AnalysisCandidate } from "@/entities/engine";

/**
 * 候補手の表示モード（`docs/state-transitions/dock-tabs.md` の D3）。
 *
 * 見るのは3つ。**押した結果が設定に残ること**、**モードを跨いで選択が残ること**、
 * **どのモードでも最善手が別の箱に出ないこと**。
 *
 * 解析の実行状態を動かさないこと（不変条件1）は `analysisControlsLifetime.test.tsx` が見る。
 */
const INITIAL_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const analysis = {
  state: {
    isAnalyzing: true,
    analyzedSfen: INITIAL_SFEN as string | null,
    candidates: [
      {
        rank: 1,
        first_move: "7g7f",
        pv_line: ["7g7f"],
        evaluation: { value: 52, kind: "Centipawn" },
      },
      {
        rank: 2,
        first_move: "2g2f",
        pv_line: ["2g2f"],
        evaluation: { value: 31, kind: "Centipawn" },
      },
    ] as AnalysisCandidate[],
  },
  candidateCache: createCandidateCache(),
  startInfiniteAnalysis: vi.fn(),
  stopAnalysis: vi.fn(),
};

const saved = { mode: null as string | null };
const setDisplayConfig = vi.fn(async (patch: { analysis_display_mode?: string | null }) => {
  if (patch.analysis_display_mode !== undefined) saved.mode = patch.analysis_display_mode ?? null;
  return { success: true as const, data: undefined };
});

vi.mock("@/entities/analysis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/analysis")>()),
  useAnalysis: () => analysis,
}));
vi.mock("@/entities/game", () => ({
  useGame: () => ({
    getCurrentTurn: () => Color.Black,
    state: { cursor: { tesuuPointer: "0,[]" } },
    view: { currentSfen: INITIAL_SFEN },
  }),
}));
vi.mock("@/entities/file-tree", () => ({ useFileTree: () => ({ selectedNode: { id: "f" } }) }));
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => ({
  useEnginePresets: () => ({ state: { selectedPresetId: "p" } }),
}));
vi.mock("@/entities/study-positions/model/useStudyPositions", () => ({
  useStudyPositions: () => ({ findBySfen: () => null }),
}));
vi.mock("@/features/board-orientation", () => ({
  useBoardOrientation: () => ({ isGotePov: false, toggle: vi.fn() }),
}));
vi.mock("@/features/settings/model/useOpenSettings", () => ({ useOpenSettings: () => vi.fn() }));
vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({
    config: { analysis_display_mode: saved.mode },
    setDisplayConfig,
  }),
}));

const { default: Pane } = await import("../AnalysisPane");
const { default: Controls } = await import("../AnalysisControls");
const { AnalysisViewStateProvider } = await import("../../model/AnalysisViewState");

/** 操作列と本体は別の段に描かれる。**状態を分け合う器の中でしか揃わない** */
function mount() {
  return render(
    <MemoryRouter>
      <AnalysisViewStateProvider>
        <Controls />
        <Pane />
      </AnalysisViewStateProvider>
    </MemoryRouter>,
  );
}

const modeButton = (label: string) => screen.getByRole("button", { name: label });

beforeEach(() => {
  saved.mode = null;
  setDisplayConfig.mockClear();
});

afterEach(cleanup);

describe("候補手の表示モード", () => {
  test("既定は表", () => {
    const { container } = mount();

    expect(container.querySelector(".candidate-table")).not.toBeNull();
  });

  // (Ta, D3)。押した結果は設定に残る（ADR-0010 決定4）
  test("押すと本体が描き変わり、選んだモードが設定に残る", () => {
    const view = mount();

    fireEvent.click(modeButton("行"));

    expect(setDisplayConfig).toHaveBeenCalledWith({ analysis_display_mode: "rows" });
    view.rerender(
      <MemoryRouter>
        <AnalysisViewStateProvider>
          <Controls />
          <Pane />
        </AnalysisViewStateProvider>
      </MemoryRouter>,
    );
    expect(view.container.querySelector(".candidates-section")).not.toBeNull();
    expect(view.container.querySelector(".candidate-table")).toBeNull();
  });

  /**
   * **最善手を別の箱にしない。** 箱にすると同じデータが2つの体系で並び、
   * 表・詳細のモードと行の並びが揃わない。どのモードでも1行目に入る。
   */
  test("どのモードでも最善手は一覧の1行目に入る", () => {
    saved.mode = "rows";
    const rows = mount();
    expect(rows.container.querySelectorAll(".candidates-section .move-sequence")).toHaveLength(2);
    cleanup();

    saved.mode = "table";
    const table = mount();
    expect(table.container.querySelectorAll(".candidate-table__row")).toHaveLength(2);
    cleanup();

    saved.mode = "detail";
    const detail = mount();
    expect(detail.container.querySelectorAll(".candidate-detail__item")).toHaveLength(2);
  });

  // 「一覧＋詳細」は読み筋の全文に届く唯一のモード（#563）
  test("一覧＋詳細では、選んだ候補の読み筋が折り返して出る", () => {
    saved.mode = "detail";
    const { container } = mount();

    fireEvent.click(container.querySelectorAll(".candidate-detail__item")[1]);

    expect(container.querySelector(".candidate-detail__pvText")?.textContent).toContain("２六歩");
  });

  test("知らない綴りが設定に残っていても既定へ落ちる", () => {
    saved.mode = "kanban";
    const { container } = mount();

    expect(container.querySelector(".candidate-table")).not.toBeNull();
  });
});
