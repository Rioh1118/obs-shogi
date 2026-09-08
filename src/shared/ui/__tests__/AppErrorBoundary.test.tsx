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

/** 与えられた値をそのままレンダで投げる。`Error` 以外も投げられる */
function Thrower({ value }: { value: unknown }): never {
  throw value;
}

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

/**
 * 落ちた原因は、画面に出す以外に利用者へ届く経路が無い。
 *
 * `console.error` は配布版では読めない（`devtools` の feature を入れておらず、
 * フロントの `console` をログファイルへ流す経路も無い）。ここで捨てると、
 * 報告に書けるものが「表示できませんでした」の一文だけになる。
 */
describe("AppErrorBoundary が捕まえる値", () => {
  // **投げられた値そのものを旗にすると、falsy な例外で境界が素通りする。**
  // 素通りした例外は外の境界も受けないので（React は「処理できなかった」と見なす）、
  // 7枚とも抜けて root ごと unmount する ——「閉じられない白い窓」に戻る
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
          <AppErrorBoundary label="盤">
            <Thrower value={value} />
          </AppErrorBoundary>,
        );
      } catch {
        escaped = true;
      }

      expect(escaped, `${name} が境界を素通りした`).toBe(false);
      expect(screen.getByText("盤を表示できませんでした。")).toBeTruthy();
    });
  }
});

describe("AppErrorBoundary が出す原因", () => {
  test("例外の文言を画面に出す", () => {
    render(
      <AppErrorBoundary label="盤">
        <Thrower value={new Error("駒を置けない升がある")} />
      </AppErrorBoundary>,
    );

    expect(screen.getByText(/駒を置けない升がある/)).toBeTruthy();
  });

  test("文字列が投げられても、そのまま出す", () => {
    render(
      <AppErrorBoundary label="盤">
        <Thrower value="文字列を投げた" />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByText(/文字列を投げた/),
      "`error.message` で読むと undefined が画面に出る",
    ).toBeTruthy();
  });

  test("`Error` でも文字列でもない値は出さない", () => {
    render(
      <AppErrorBoundary label="盤" hint="棋譜を開き直してください。">
        <Thrower value={{ code: 1 }} />
      </AppErrorBoundary>,
    );

    // `String({})` は `[object Object]`。案内より目立つ位置に意味の無い1行が入る
    expect(screen.queryByText(/技術的な内容/)).toBeNull();
    expect(screen.getByText("棋譜を開き直してください。")).toBeTruthy();
  });
});

describe("AppErrorBoundary が残す記録", () => {
  test("どの境界が受けたかを添えて `console.error` に出す", () => {
    render(
      <AppErrorBoundary label="解析">
        <Thrower value={new Error("読み筋が組めない")} />
      </AppErrorBoundary>,
    );

    // 境界は入れ子なので、名乗りが無いとログからも受け側を特定できない。
    // **潰すだけのテストだと、この行を消しても変異が生き残る**
    const calls = vi.mocked(console.error).mock.calls;
    expect(calls.some((args) => String(args[0]).includes("[AppErrorBoundary:解析]"))).toBe(true);
  });
});

describe("AppErrorBoundary が出す案内", () => {
  test("既定の fallback にも `hint` が届く", () => {
    render(
      <AppErrorBoundary label="盤" hint="棋譜を開き直してください。">
        <Thrower value={new Error("落ちた")} />
      </AppErrorBoundary>,
    );

    // 既定の fallback へ素通ししないと、案内を書けるのは fallback を渡した境界だけになる
    expect(screen.getByText("棋譜を開き直してください。")).toBeTruthy();
  });
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

  test("落ちている間に鍵が動いても、境界は捕まえ続ける", () => {
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

    // 比較の相手を落ちた時点で止めると、毎レンダ「変わった」と判定して子を描き直し続け、
    // 境界は捕まえ直せずに例外が外へ抜ける（このレンダで throw が飛び出す）
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
