// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

/**
 * `/app` の下で throw しても、ウィンドウ枠（`TitleBar`）は残る。
 *
 * 枠は自前で描いていて（`tauri.conf.json` の `decorations: false`）、
 * `RuntimeShell` の中に居る。境界を `TitleBar` **より上**へ動かすと、
 * 盤やペインが落ちただけで枠まで差し替わり、ウィンドウを動かせなくなる。
 * 位置そのものをここで固定する —— 上下どちらに置いても型では落ちない。
 */

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }),
}));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { root_dir: "/ws" }, isLoading: false, error: null }),
}));

// provider の入れ子はこの検査の対象外。器だけ残す
vi.mock("../../providers/RuntimeProviders", () => ({
  RuntimeProviders: ({ children }: { children: ReactNode }) => children,
}));

const { default: RuntimeShell } = await import("../RuntimeShell");

function Throwing(): ReactNode {
  throw new Error("ペインの中で落ちた");
}

beforeEach(() => {
  // 境界が捕まえた例外は `componentDidCatch` と React の両方が出す。出力だけ畳む
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RuntimeShell の境界", () => {
  test("`/app` の下の例外を受け止め、TitleBar を残す", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/app"]}>
        <Routes>
          <Route element={<RuntimeShell />}>
            <Route path="/app" element={<Throwing />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("作業画面を表示できませんでした。")).toBeTruthy();
    expect(
      container.querySelector(".titlebar"),
      "枠まで畳むと、ウィンドウを動かすことも閉じることもできなくなる",
    ).not.toBeNull();
  });
});
