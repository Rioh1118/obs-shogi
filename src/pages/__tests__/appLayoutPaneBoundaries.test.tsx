// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

/**
 * ペイン1つの事故で作業面を丸ごと畳まない。
 *
 * 上に `RuntimeShell` の境界があるので、ここに境界が無くても白い窓にはならない
 * ——**作業面がまるごと「表示中にエラーが発生しました」に置き換わる**だけになる。
 * 見ているものが全部消えるので、盤が落ちたのか棋譜が落ちたのかも分からない。
 *
 * 境界を1枚外しても型でもレンダでも落ちない。畳まれる範囲をここで固定する。
 */

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    view: { hasKifu: true },
    state: { selectedPosition: null },
    clearSelection: vi.fn(),
  }),
}));

/** どのペインを落とすか。テストごとに1つだけ真にする */
const explode = { board: false, analysis: false };

function exploding(name: "board" | "analysis", testId: string) {
  return {
    default: () => {
      if (explode[name]) throw new Error(`${name} の中で落ちた`);
      return <div data-testid={testId} />;
    },
  };
}

const empty = { default: () => null };
vi.mock("@/pages/AppModalLayer", () => empty);
vi.mock("@/pages/WelcomeScreen", () => empty);
vi.mock("@/widgets/app-layout-header/ui/AppLayoutHeader", () => empty);
vi.mock("@/widgets/game-board/ui/Hand", () => empty);
vi.mock("@/widgets/game-board/ui/GameControls", () => empty);
vi.mock("@/widgets/kifu-stream/ui/KifuStreamList", () => ({
  default: () => <div data-testid="kifu" />,
}));
vi.mock("@/widgets/game-board/ui/Board", () => empty);
vi.mock("@/widgets/game-board/ui/GameBoard", () => exploding("board", "board"));
vi.mock("@/widgets/analysis-pane/ui/AnalysisPane", () => exploding("analysis", "analysis"));

const { default: AppLayout } = await import("../AppLayout");

function mount() {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/app" element={<AppLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // 境界が捕まえた例外は `componentDidCatch` と React の両方が出す。出力だけ畳む
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  explode.board = false;
  explode.analysis = false;
  cleanup();
  vi.restoreAllMocks();
});

describe("ペインごとの境界", () => {
  test("盤が落ちても、棋譜一覧と解析ペインは残る", () => {
    explode.board = true;
    const { container } = mount();

    expect(container.querySelector(".workspace"), "作業面まで畳んでいる").not.toBeNull();
    expect(container.querySelector('[data-testid="analysis"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kifu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board"]')).toBeNull();
  });

  test("解析ペインが落ちても、盤と棋譜一覧は残る", () => {
    explode.analysis = true;
    const { container } = mount();

    expect(container.querySelector(".workspace"), "作業面まで畳んでいる").not.toBeNull();
    expect(container.querySelector('[data-testid="board"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kifu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="analysis"]')).toBeNull();
  });
});
