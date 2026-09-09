// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary, BOUNDARY_LABELS, type ErrorBoundaryView } from "../AppErrorBoundary";

/**
 * 境界が持つのは「捕まえたか」と「畳みを解く鍵」だけ。**見せ方はここでは見ない**
 * （`error-fallback/__tests__/errorFallback.test.tsx`）。
 *
 * 境界から出る手段が「再表示」しか無いと、**押しても画面が1ドットも変わらない**行き止まりになる。
 * `reset` は自分の `error` を消すだけで、落ちた原因は境界の**外**（provider の state、URL）に
 * 残っている。同じ state で描き直せば同じ行で落ちる。逆に、原因が消えても
 * （別の画面へ移った、モーダルを閉じた）境界はそれを知らないので畳んだままになる。
 * どちらも利用者からは「壊れたまま」に見え、**例外もエラー表示も出ない。**
 *
 * `resetKeys` の比較そのものをここで固定する。壊れても型では落ちない。
 */

/** 与えられた値をそのままレンダで投げる。`Error` 以外も投げられる */
function Throwing({ value }: { value: unknown }): never {
  throw value;
}

/** `boom` が真の間だけレンダで投げる */
function Child({ boom }: { boom: boolean }) {
  if (boom) throw new Error("子が落ちた");
  return <div data-testid="child" />;
}

/**
 * 見せ方を持たない `fallback`。**畳んだこと・投げられた値・出口だけを出す。**
 *
 * 本文の部品を使うと、本文の文言を変えただけでこのファイルが赤くなる
 */
const bare = (view: ErrorBoundaryView) => (
  <div data-testid="fallback">
    <span data-testid="caught">{String(view.error)}</span>
    <button type="button" onClick={view.reset}>
      畳みを解く
    </button>
  </div>
);

beforeEach(() => {
  // 境界が捕まえた例外は `componentDidCatch` と React の両方が出す。出力だけ畳む
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppErrorBoundary が捕まえる値", () => {
  // **投げられた値そのものを旗にすると、falsy な例外で境界が素通りする。**
  // 素通りした例外は外の境界も受けないので（React は「処理できなかった」と見なす）、
  // 入れ子の何枚目でも抜けて root ごと unmount する ——「閉じられない白い窓」に戻る
  for (const [name, value] of [
    ["undefined", undefined],
    ["null", null],
    ["空文字", ""],
    ["0", 0],
    ["false", false],
  ] as const) {
    test(`${name} を投げても畳む`, () => {
      let escaped = false;
      try {
        render(
          <AppErrorBoundary label={BOUNDARY_LABELS.board} fallback={bare}>
            <Throwing value={value} />
          </AppErrorBoundary>,
        );
      } catch {
        escaped = true;
      }

      expect(escaped, `${name} が境界を素通りした`).toBe(false);
      expect(screen.getByTestId("fallback")).toBeTruthy();
    });
  }
});

describe("AppErrorBoundary が fallback へ渡すもの", () => {
  test("投げられた値をそのまま渡す", () => {
    // 境界が値を握ると、画面にも報告にも出せるものが「表示できませんでした」の一文だけになる
    render(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} fallback={bare}>
        <Throwing value={new Error("駒を置けない升がある")} />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId("caught").textContent).toContain("駒を置けない升がある");
  });

  test("名乗りをそのまま渡す", () => {
    // 名乗りは境界の識別子でもある。渡らないと、fallback 側は
    // どの範囲が畳まれたかを自分で書き足すことになり、写しが増える
    let seen = "";
    render(
      <AppErrorBoundary
        label={BOUNDARY_LABELS.analysis}
        fallback={(view) => {
          seen = view.label;
          return null;
        }}
      >
        <Throwing value={new Error("落ちた")} />
      </AppErrorBoundary>,
    );

    expect(seen).toBe(BOUNDARY_LABELS.analysis);
  });
});

describe("AppErrorBoundary が残す記録", () => {
  test("どの境界が受けたかを添えて `console.error` に出す", () => {
    render(
      <AppErrorBoundary label={BOUNDARY_LABELS.analysis} fallback={bare}>
        <Throwing value={new Error("読み筋が組めない")} />
      </AppErrorBoundary>,
    );

    // 境界は入れ子なので、名乗りが無いとログからも受け側を特定できない。
    // **潰すだけのテストだと、この行を消しても変異が生き残る**
    const calls = vi.mocked(console.error).mock.calls;
    expect(calls.some((args) => String(args[0]).includes("[AppErrorBoundary:解析]"))).toBe(true);
  });
});

describe("AppErrorBoundary の resetKeys", () => {
  test("鍵が変わったら畳むのをやめる", () => {
    const { rerender } = render(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["a"]} fallback={bare}>
        <Child boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();

    rerender(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["b"]} fallback={bare}>
        <Child boom={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  test("鍵が同じなら、描き直しても畳んだまま", () => {
    const { rerender } = render(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["a"]} fallback={bare}>
        <Child boom />
      </AppErrorBoundary>,
    );

    rerender(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["a"]} fallback={bare}>
        <Child boom={false} />
      </AppErrorBoundary>,
    );
    expect(
      screen.getByTestId("fallback"),
      "鍵が動いていないのに解けると、落ち続けるものを描き直し続けて fallback が出なくなる",
    ).toBeTruthy();
  });

  test("落ちている間に鍵が動いても、境界は捕まえ続ける", () => {
    const { rerender } = render(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["a"]} fallback={bare}>
        <Child boom />
      </AppErrorBoundary>,
    );

    // **ここが変異を殺す。** 比較の相手を落ちた時点で止めると、毎レンダ「変わった」と判定して
    // 子を描き直し続け、境界は捕まえ直せずにこの rerender で例外が飛び出す
    rerender(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["b"]} fallback={bare}>
        <Child boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();

    // 原因が消えて鍵が動いたので、ここで畳むのをやめる
    rerender(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["c"]} fallback={bare}>
        <Child boom={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  test("`reset` は原因が残っていれば同じ画面に戻る", () => {
    render(
      <AppErrorBoundary label={BOUNDARY_LABELS.board} resetKeys={["a"]} fallback={bare}>
        <Child boom />
      </AppErrorBoundary>,
    );

    fireEvent.click(screen.getByText("畳みを解く"));

    expect(
      screen.getByTestId("fallback"),
      "**いまの仕様。** 原因が境界の外にあるので `reset` では消えない。押しても変わらないことを利用者に伝える手段はまだ無い",
    ).toBeTruthy();
  });
});
