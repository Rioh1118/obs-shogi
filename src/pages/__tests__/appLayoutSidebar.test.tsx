// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReactNode } from "react";

/**
 * サイドバーの開閉と、盤の外を押したときの選択の解除。
 *
 * 開閉の state は `AppLayout` が持ち、ヘッダのボタンとサイドバーの両方へ配る。
 * 片方へ渡し損ねると、押してもサイドバーが動かないか、ボタンの見た目だけが
 * 逆になる。どちらも例外は出ない。
 */

const game = { hasKifu: false };
const clearSelection = vi.fn();

vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = {
    ...actual,
    useGame: (() => ({ view: game })) as unknown as typeof actual.useGame,
  };
  return mocked satisfies typeof import("@/entities/game");
});
vi.mock("@/features/clear-board-selection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/clear-board-selection")>();
  const mocked = {
    ...actual,
    useClearBoardSelection: (() =>
      clearSelection) as unknown as typeof actual.useClearBoardSelection,
  };
  return mocked satisfies typeof import("@/features/clear-board-selection");
});

/** ヘッダが最後に受け取った prop */
let header: { toggleSidebar: () => void; isSidebarOpen: boolean } | null = null;
vi.mock(
  "@/widgets/app-layout-header/ui/AppLayoutHeader",
  () =>
    ({
      default: (props: { toggleSidebar: () => void; isSidebarOpen: boolean }) => {
        header = props;
        // 子が伝播を止めても、取り込みの段で受けていれば届く
        return (
          <button type="button" onPointerDown={(event) => event.stopPropagation()}>
            header
          </button>
        );
      },
    }) satisfies typeof import("@/widgets/app-layout-header/ui/AppLayoutHeader"),
);
/** サイドバーが最後に受け取った開閉 */
let sidebarOpen: boolean | null = null;
vi.mock(
  "@/widgets/sidebar/ui/Sidebar",
  () =>
    ({
      default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => {
        sidebarOpen = isOpen;
        return <div>{children}</div>;
      },
    }) satisfies typeof import("@/widgets/sidebar/ui/Sidebar"),
);

const empty = <></>;
vi.mock(
  "@/pages/AppModalLayer",
  () => ({ default: () => empty }) satisfies typeof import("../AppModalLayer"),
);
vi.mock(
  "@/pages/WelcomeScreen",
  () => ({ default: () => empty }) satisfies typeof import("../WelcomeScreen"),
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

beforeEach(() => {
  header = null;
  sidebarOpen = null;
  clearSelection.mockReset();
});
afterEach(cleanup);

describe("サイドバーの開閉", () => {
  test("開いた状態で始まる", () => {
    mount();

    expect(header?.isSidebarOpen).toBe(true);
    expect(sidebarOpen).toBe(true);
  });

  test("ヘッダのボタンで閉じ、もう一度で開く。ヘッダとサイドバーは同じ値を読む", () => {
    mount();

    act(() => header!.toggleSidebar());
    expect(header?.isSidebarOpen).toBe(false);
    expect(sidebarOpen).toBe(false);

    act(() => header!.toggleSidebar());
    expect(header?.isSidebarOpen).toBe(true);
    expect(sidebarOpen).toBe(true);
  });
});

describe("盤の外を押したときの選択の解除", () => {
  test("画面のどこを押しても、子より先に解除の判定へ渡す", () => {
    mount();

    fireEvent.pointerDown(screen.getByRole("button", { name: "header" }));

    expect(clearSelection).toHaveBeenCalledTimes(1);
  });
});
