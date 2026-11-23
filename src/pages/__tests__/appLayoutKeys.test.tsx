// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

/**
 * 作業画面のキーが棋譜の移動に繋がっていること。
 *
 * 付け忘れても例外は出ず、押しても何も起きないだけになる。
 * どのキーを受けるかは `features/kifu-navigation-keys` のテストが見る。
 */

const game = vi.hoisted(() => ({
  view: { hasKifu: true },
  state: { selectedPosition: null },
  clearSelection: vi.fn(),
  goToStart: vi.fn(),
  previousMove: vi.fn(),
  nextMove: vi.fn(),
  goToEnd: vi.fn(),
}));

vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = {
    ...actual,
    useGame: (() => game) as unknown as typeof actual.useGame,
  };
  return mocked satisfies typeof import("@/entities/game");
});

const empty = { default: () => <></> };
vi.mock("@/pages/AppModalLayer", () => empty satisfies typeof import("../AppModalLayer"));
vi.mock("@/pages/WelcomeScreen", () => empty satisfies typeof import("../WelcomeScreen"));
vi.mock("@/widgets/dock/ui/Dock", () => empty satisfies typeof import("@/widgets/dock/ui/Dock"));
vi.mock(
  "@/widgets/app-layout-header/ui/AppLayoutHeader",
  () => empty satisfies typeof import("@/widgets/app-layout-header/ui/AppLayoutHeader"),
);
vi.mock(
  "@/widgets/kifu-stream/ui/KifuStreamList",
  () => empty satisfies typeof import("@/widgets/kifu-stream/ui/KifuStreamList"),
);
vi.mock(
  "@/widgets/game-board/ui/GameBoard",
  () => empty satisfies typeof import("@/widgets/game-board/ui/GameBoard"),
);
vi.mock(
  "@/widgets/game-board/ui/GameControls",
  () => empty satisfies typeof import("@/widgets/game-board/ui/GameControls"),
);

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
  cleanup();
  vi.clearAllMocks();
});

describe("作業画面のキー", () => {
  test.each([
    ["ArrowLeft", "previousMove"],
    ["ArrowRight", "nextMove"],
    ["Home", "goToStart"],
    ["End", "goToEnd"],
  ] as const)("%s は %s", (key, operation) => {
    mount();

    fireEvent.keyDown(document.body, { key });

    expect(game[operation]).toHaveBeenCalledTimes(1);
  });

  test("作業画面から外れたら受けない", () => {
    const { unmount } = mount();
    unmount();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });

    expect(game.nextMove).not.toHaveBeenCalled();
  });
});
