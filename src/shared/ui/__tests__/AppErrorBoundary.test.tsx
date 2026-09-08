// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "../AppErrorBoundary";

/**
 * 境界から出る手段が「再表示」しか無いと、**押しても画面が1ドットも変わらない**行き止まりになる。
 *
 * `reset` は自分の `error` を消すだけで、落ちた原因は境界の**外**（provider の state、URL）に
 * 残っている。同じ state で描き直せば同じ行で落ちる。逆に、原因が消えても
 * （別の画面へ移った、モーダルを閉じた）境界はそれを知らないので畳んだままになる。
 * どちらも利用者からは「壊れたまま」に見え、**例外もエラー表示も出ない。**
 *
 * `resetKeys` の比較そのものをここで固定する。壊れても型では落ちない。
 */

/** `boom` が真の間だけレンダで投げる */
function Child({ boom }: { boom: boolean }) {
  if (boom) throw new Error("子が落ちた");
  return <div data-testid="child" />;
}

beforeEach(() => {
  // 境界が捕まえた例外は `componentDidCatch` と React の両方が出す。出力だけ畳む
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppErrorBoundary の resetKeys", () => {
  test("鍵が変わったら畳むのをやめる", () => {
    const { rerender } = render(
      <AppErrorBoundary label="盤" resetKeys={["a"]}>
        <Child boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("盤を表示できませんでした。")).toBeTruthy();

    rerender(
      <AppErrorBoundary label="盤" resetKeys={["b"]}>
        <Child boom={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  test("鍵が同じなら、描き直しても畳んだまま", () => {
    const { rerender } = render(
      <AppErrorBoundary label="盤" resetKeys={["a"]}>
        <Child boom />
      </AppErrorBoundary>,
    );

    rerender(
      <AppErrorBoundary label="盤" resetKeys={["a"]}>
        <Child boom={false} />
      </AppErrorBoundary>,
    );
    expect(
      screen.getByText("盤を表示できませんでした。"),
      "鍵が動いていないのに解けると、落ち続けるものを描き直し続けて fallback が出なくなる",
    ).toBeTruthy();
  });

  test("落ちている間に鍵が2回動いても、2回目で解ける", () => {
    const { rerender } = render(
      <AppErrorBoundary label="盤" resetKeys={["a"]}>
        <Child boom />
      </AppErrorBoundary>,
    );

    // 1回目の変化では原因が残っていて、解けた直後にまた落ちる
    rerender(
      <AppErrorBoundary label="盤" resetKeys={["b"]}>
        <Child boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("盤を表示できませんでした。")).toBeTruthy();

    // 比較の相手が落ちた時点の鍵に留まっていると、ここが "b" のままで解けない
    rerender(
      <AppErrorBoundary label="盤" resetKeys={["c"]}>
        <Child boom={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  test("`再表示` は原因が残っていれば同じ画面に戻る", () => {
    render(
      <AppErrorBoundary label="盤" resetKeys={["a"]}>
        <Child boom />
      </AppErrorBoundary>,
    );

    fireEvent.click(screen.getByText("再表示"));

    expect(
      screen.getByText("盤を表示できませんでした。"),
      "**いまの仕様。** 原因が境界の外にあるので `reset` では消えない。押しても変わらないことを利用者に伝える手段はまだ無い",
    ).toBeTruthy();
  });
});
