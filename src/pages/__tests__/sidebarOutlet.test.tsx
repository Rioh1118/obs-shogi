// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

/**
 * `panel/*` のルートはサイドバーの中に描かれる。
 *
 * ルート表（`AppRouter`）と描画位置（`.sidebar`）の間に `AppLayout` が挟まっていて、
 * **どちらのファイルを読んでも繋がりが見えない。** `Outlet` を消したり別の枠へ
 * 移したりしても、型でもレンダでも落ちない——サイドバーが**空になるだけ**で、
 * 例外もエラー表示も出ない。ここで場所ごと固定する。
 */

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    view: { hasKifu: false },
    state: { selectedPosition: null },
    clearSelection: vi.fn(),
  }),
}));

// 盤・棋譜・解析・モーダルはこの検査の対象外。枠だけ残す
const empty = { default: () => null };
vi.mock("@/pages/AppModalLayer", () => ({
  ...empty,
  useModalLayerResetKeys: () => [],
}));
vi.mock("@/pages/WelcomeScreen", () => empty);
vi.mock("@/widgets/analysis-pane/ui/AnalysisPane", () => empty);
vi.mock("@/widgets/app-layout-header/ui/AppLayoutHeader", () => empty);
vi.mock("@/widgets/kifu-stream/ui/KifuStreamList", () => empty);
vi.mock("@/widgets/game-board/ui/GameBoard", () => empty);
vi.mock("@/widgets/game-board/ui/Board", () => empty);
vi.mock("@/widgets/game-board/ui/Hand", () => empty);
vi.mock("@/widgets/game-board/ui/GameControls", () => empty);

const { default: AppLayout } = await import("../AppLayout");

/** `AppRouter` と同じ入れ子。パネルの中身だけ差し替える */
function mountPanel() {
  return render(
    <MemoryRouter initialEntries={["/app/panel/filetree"]}>
      <Routes>
        <Route path="/app" element={<AppLayout />}>
          <Route path="panel">
            <Route path="filetree" element={<div data-testid="panel">パネル</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("サイドバーの中身", () => {
  test("panel のルートはサイドバーの中に入る", () => {
    const { container } = mountPanel();

    const panel = container.querySelector('[data-testid="panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.closest(".sidebar")).not.toBeNull();
  });
});
