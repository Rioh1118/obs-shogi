// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

/**
 * ペイン1つの事故で作業面を丸ごと畳まない。
 *
 * 上に `RuntimeShell` の境界があるので、ここに境界が無くても白い窓にはならない
 * ——**作業面がまるごと「作業画面を表示できませんでした。」に置き換わる**だけになる。
 * 見ているものが全部消えるので、何が落ちたのかも分からない。
 *
 * 境界を1枚外しても型でもレンダでも落ちない。**受けた境界の名乗り**と
 * 畳まれる範囲の両方をここで固定する。名乗りを見ないと、内側の1枚を外しても
 * 外側が同じ形で受けるので緑のまま通る。
 */

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    view: { hasKifu: true },
    state: { selectedPosition: null },
    clearSelection: vi.fn(),
  }),
}));

/** どのペインを落とすか。テストごとに1つだけ真にする */
const throwing = { board: false, analysis: false };

function mockThrowing(name: keyof typeof throwing, testId: string) {
  return {
    default: () => {
      if (throwing[name]) throw new Error(`${name} の中で落ちた`);
      return <div data-testid={testId} />;
    },
  };
}

const empty = { default: () => null };
// 境界ごとこの層の中に居るので、落ちたときの振る舞いは AppModalLayer.test.tsx が見る
vi.mock("@/pages/AppModalLayer", () => empty);
vi.mock("@/pages/WelcomeScreen", () => empty);
vi.mock("@/widgets/app-layout-header/ui/AppLayoutHeader", () => empty);
vi.mock("@/widgets/game-board/ui/Hand", () => empty);
vi.mock("@/widgets/game-board/ui/GameControls", () => empty);
vi.mock("@/widgets/kifu-stream/ui/KifuStreamList", () => ({
  default: () => <div data-testid="kifu" />,
}));
vi.mock("@/widgets/game-board/ui/Board", () => empty);
vi.mock("@/widgets/game-board/ui/GameBoard", () => mockThrowing("board", "board"));
vi.mock("@/widgets/analysis-pane/ui/AnalysisPane", () => mockThrowing("analysis", "analysis"));

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
  throwing.board = false;
  throwing.analysis = false;
  cleanup();
  vi.restoreAllMocks();
});

describe("ペインごとの境界", () => {
  test("盤が落ちても、棋譜一覧と解析ペインは残る", () => {
    throwing.board = true;
    const { container } = mount();

    expect(container.querySelector(".workspace"), "作業面まで畳んでいる").not.toBeNull();
    // **どの境界が受けたかを文言で見る。** 同じ文言だと、盤の境界を外しても
    // 上の境界が同じ画面で受けて退行が見えない
    expect(screen.getByText("盤を表示できませんでした。")).toBeTruthy();
    expect(container.querySelector('[data-testid="analysis"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kifu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board"]')).toBeNull();
  });

  test("解析ペインが落ちても、盤と棋譜一覧は残る", () => {
    throwing.analysis = true;
    const { container } = mount();

    expect(container.querySelector(".workspace"), "作業面まで畳んでいる").not.toBeNull();
    expect(screen.getByText("解析を表示できませんでした。")).toBeTruthy();
    expect(container.querySelector('[data-testid="board"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kifu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="analysis"]')).toBeNull();
  });
});
