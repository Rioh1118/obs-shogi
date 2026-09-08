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

/** 更新の知らせは平常時 `null` か portal で、`.app-root` に in-flow の子を作らない */
let updaterThrowing = false;
vi.mock("@/features/updater/ui/UpdaterScreen", () => ({
  default: () => {
    if (updaterThrowing) throw new Error("更新の知らせの中で落ちた");
    return <div data-testid="updater" />;
  },
}));
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
  updaterThrowing = false;
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

    expect(screen.getByText("アプリを表示できませんでした。")).toBeTruthy();

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

  test("画面の名乗りとログの名乗りが同じ `label` から出ている", () => {
    render(<App />);

    // fallback が名乗りを書き直すと、`label` を直してもログだけが変わって画面は古いまま残る
    const logged = vi
      .mocked(console.error)
      .mock.calls.some((args) => String(args[0]).includes("[AppErrorBoundary:アプリ]"));
    expect(logged).toBe(true);
    expect(screen.getByText("アプリを表示できませんでした。")).toBeTruthy();
  });

  test("帯の丸だけでなく、文字のボタンでも閉じられる", () => {
    render(<App />);

    // 12px の色の丸は、失敗の直後にいちばん見つけにくい導線になる
    fireEvent.click(screen.getByText("ウィンドウを閉じる"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("閉じられなかったら、そのことを画面に出す", async () => {
    close.mockRejectedValueOnce(new Error("IPC が落ちている"));
    render(<App />);

    fireEvent.click(screen.getByLabelText("ウィンドウを閉じる"));

    expect(
      await screen.findByRole("alert"),
      "最後の手段が黙って失敗すると、押しても何も起きないボタンだけが残る",
    ).toBeTruthy();
  });

  test("更新の知らせが落ちても、本体は畳まない", () => {
    throwing = false;
    updaterThrowing = true;
    const { container } = render(<App />);

    expect(
      screen.getByTestId("router"),
      "更新の知らせ1枚の事故で、動いているアプリ全体が最後の砦に差し替わっている",
    ).toBeTruthy();
    // in-flow の箱を作ると `.app-root`（flex column）の列を1つ食い、本体が縮む
    expect(container.querySelector(".app-error-fallback--floating")).not.toBeNull();
  });

  test("本体が落ちても、更新の知らせは残る", () => {
    render(<App />);

    expect(screen.getByText("アプリを表示できませんでした。")).toBeTruthy();
    expect(
      screen.getByTestId("updater"),
      "その状態を直す版が、その状態のせいで届かなくなっている",
    ).toBeTruthy();
  });

  test("再表示で元の画面へ戻れる", () => {
    render(<App />);

    throwing = false;
    fireEvent.click(screen.getByText("再表示"));

    expect(screen.getByTestId("router")).toBeTruthy();
  });
});
