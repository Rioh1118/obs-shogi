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
const explode = { board: false, analysis: false, modal: false };

function exploding(name: keyof typeof explode, testId: string) {
  return {
    default: () => {
      if (explode[name]) throw new Error(`${name} の中で落ちた`);
      return <div data-testid={testId} />;
    },
  };
}

const empty = { default: () => null };
// 平常時 `createPortal` で描くので、`.app-layout` には in-flow の子を作らない
vi.mock("@/pages/AppModalLayer", () => ({
  default: () => {
    if (explode.modal) throw new Error("modal の中で落ちた");
    return null;
  },
}));
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
  explode.modal = false;
  cleanup();
  vi.restoreAllMocks();
});

describe("ペインごとの境界", () => {
  test("盤が落ちても、棋譜一覧と解析ペインは残る", () => {
    explode.board = true;
    const { container } = mount();

    expect(container.querySelector(".workspace"), "作業面まで畳んでいる").not.toBeNull();
    // **どの境界が受けたかを文言で見る。** 同じ文言だと、盤の境界を外しても
    // 上の境界が同じ画面で受けて退行が見えない
    expect(screen.getByText("盤を表示できませんでした。")).toBeTruthy();
    expect(container.querySelector('[data-testid="analysis"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kifu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board"]')).toBeNull();
  });

  test("モーダル層が落ちても、`.app-layout` の段割りを崩さない", () => {
    explode.modal = true;
    const { container } = mount();

    const fallback = container.querySelector(".app-error-fallback");
    expect(fallback).not.toBeNull();
    expect(
      fallback!.classList.contains("app-error-fallback--floating"),
      [
        "`.app-layout` は grid-template-rows が2段で、ヘッダと本体でちょうど埋まっている。",
        "in-flow の箱を作る fallback を出すと1段目を取り、本体が暗黙の3段目へ押し出されて",
        "overflow: hidden に切られる（=盤も棋譜も解析も消える）。",
      ].join("\n"),
    ).toBe(true);
    expect(container.querySelector(".app-layout__body")).not.toBeNull();
  });

  test("解析ペインが落ちても、盤と棋譜一覧は残る", () => {
    explode.analysis = true;
    const { container } = mount();

    expect(container.querySelector(".workspace"), "作業面まで畳んでいる").not.toBeNull();
    expect(screen.getByText("解析を表示できませんでした。")).toBeTruthy();
    expect(container.querySelector('[data-testid="board"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="kifu"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="analysis"]')).toBeNull();
  });
});
