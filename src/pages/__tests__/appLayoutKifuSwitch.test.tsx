// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

/**
 * 棋譜が無ければ `WelcomeScreen`、あれば作業面。**判断はページが持つ。**
 *
 * 何をもって「ある」とするかは game が `hasKifu` で答える。ページが
 * `player?.shogi` を組み立て直すと、`player !== null` で縮めた人と混ざって
 * **同じ問いに2つの答え**ができる。
 *
 * 狂っても例外は出ない——棋譜があるのに WelcomeScreen が出るか、
 * 棋譜が無いのに空の盤面が出るだけ。ここで切り替えを固定する。
 */

const game = { hasKifu: false };

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    view: game,
    state: { selectedPosition: null },
    clearSelection: vi.fn(),
  }),
}));

// 中身はこの検査の対象外。どちらの枝が選ばれたかだけを見る
const empty = { default: () => null };
vi.mock("@/pages/AppModalLayer", () => ({
  ...empty,
  useModalLayerResetKeys: () => [],
}));
vi.mock("@/pages/WelcomeScreen", () => ({ default: () => <div data-testid="welcome" /> }));
vi.mock("@/widgets/analysis-pane/ui/AnalysisPane", () => empty);
vi.mock("@/widgets/app-layout-header/ui/AppLayoutHeader", () => empty);
vi.mock("@/widgets/kifu-stream/ui/KifuStreamList", () => empty);
vi.mock("@/widgets/game-board/ui/GameBoard", () => empty);
vi.mock("@/widgets/game-board/ui/Board", () => empty);
vi.mock("@/widgets/game-board/ui/Hand", () => empty);
vi.mock("@/widgets/game-board/ui/GameControls", () => empty);

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

afterEach(() => {
  game.hasKifu = false;
  cleanup();
});

describe("棋譜の有無で画面を切り替える", () => {
  test("棋譜が無ければ WelcomeScreen", () => {
    const { container } = mount();

    expect(container.querySelector('[data-testid="welcome"]')).not.toBeNull();
    expect(container.querySelector(".workspace")).toBeNull();
  });

  test("棋譜があれば作業面", () => {
    game.hasKifu = true;
    const { container } = mount();

    expect(container.querySelector(".workspace")).not.toBeNull();
    expect(container.querySelector('[data-testid="welcome"]')).toBeNull();
  });
});
