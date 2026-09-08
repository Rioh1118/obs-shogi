// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * root の境界を抜けた例外は、**閉じられない窓**になる。
 *
 * ウィンドウ枠は自前で描いていて（`tauri.conf.json` の `decorations: false`）、
 * `TitleBar` は `RuntimeShell` の中に居る。root まで例外が上がると枠ごと消えるので、
 * 画面には閉じるボタンもドラッグ領域も残らず、利用者に残るのは強制終了だけになる。
 *
 * 境界を1枚外しても**型でもレンダでも落ちない**（React は静かに root を unmount する）。
 * 実際に throw させて、枠が出ることをここで固定する。
 */

const close = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close }) }));

vi.mock("@/features/updater/ui/UpdaterScreen", () => ({ default: () => null }));
vi.mock("../providers/BootstrapProviders", () => ({
  BootstrapProviders: ({ children }: { children: ReactNode }) => children,
}));

/** ルータの中身は関係無い。落ちる／落ちないを切り替えるためだけの差し替え */
let throwing = true;
vi.mock("../routing/AppRouter", () => ({
  default: () => {
    if (throwing) throw new Error("ルータの下で落ちた");
    return <div data-testid="router">画面</div>;
  },
}));

const { default: App } = await import("../App");

beforeEach(() => {
  throwing = true;
  // 境界が捕まえた例外は `componentDidCatch` と React の両方が出す。
  // 出ること自体は意図どおりなので、出力だけ畳む
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  close.mockClear();
  vi.restoreAllMocks();
});

describe("root の境界", () => {
  test("下で throw しても、ウィンドウを閉じる手段が画面に残る", () => {
    const { container } = render(<App />);

    expect(screen.getByText("表示中にエラーが発生しました。")).toBeTruthy();

    const dragRegion = container.querySelector('[data-tauri-drag-region="true"]');
    expect(dragRegion, "ドラッグ領域が無いとウィンドウを動かせない").not.toBeNull();

    const closeButton = screen.getByLabelText("ウィンドウを閉じる");
    expect(
      closeButton.getAttribute("data-tauri-drag-region"),
      "ボタンがドラッグ領域のままだと、押しても閉じずにウィンドウが動く",
    ).toBe("false");

    fireEvent.click(closeButton);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("再表示で元の画面へ戻れる", () => {
    render(<App />);

    throwing = false;
    fireEvent.click(screen.getByText("再表示"));

    expect(screen.getByTestId("router")).toBeTruthy();
  });
});
