// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary, BOUNDARY_LABELS } from "@/shared/ui/AppErrorBoundary";
import { ErrorFallbackBody } from "../ErrorFallbackBody";
import { FloatingErrorFallback } from "../FloatingErrorFallback";

/**
 * 落ちた画面の見せ方を固定する。**境界の振る舞いはここでは見ない**
 * （`shared/ui/__tests__/AppErrorBoundary.test.tsx`）。
 *
 * 落ちた原因は、画面に出す以外に利用者へ届く経路が無い。`console.error` は配布版では
 * 読めない（`devtools` の feature を入れておらず、フロントの `console` をログファイルへ
 * 流す経路も無い）。ここで捨てると、報告に書けるものが「表示できませんでした」の一文だけになる。
 */

const noop = () => {};

/**
 * 浮かせた枠を積む器。`index.html` が持っているものを、テストでは自分で立てる
 * （`Modal.test.tsx` の `#modal-root` と同じ）
 */
const OVERLAY_ROOT_ID = "error-overlay-root";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const root = document.createElement("div");
  root.id = OVERLAY_ROOT_ID;
  document.body.appendChild(root);
});

afterEach(() => {
  cleanup();
  document.getElementById(OVERLAY_ROOT_ID)?.remove();
  vi.restoreAllMocks();
});

describe("ErrorFallbackBody が出す原因", () => {
  test("例外の文言を画面に出す", () => {
    render(
      <ErrorFallbackBody
        label={BOUNDARY_LABELS.board}
        error={new Error("駒を置けない升がある")}
        reset={noop}
      />,
    );

    expect(screen.getByText(/駒を置けない升がある/)).toBeTruthy();
  });

  test("文字列が投げられても、そのまま出す", () => {
    render(<ErrorFallbackBody label={BOUNDARY_LABELS.board} error="文字列を投げた" reset={noop} />);

    expect(
      screen.getByText(/文字列を投げた/),
      "`error.message` で読むと undefined が画面に出る",
    ).toBeTruthy();
  });

  test("`Error` でも文字列でもない値は出さない", () => {
    render(
      <ErrorFallbackBody
        label={BOUNDARY_LABELS.board}
        error={{ code: 1 }}
        reset={noop}
        hint="棋譜を開き直してください。"
      />,
    );

    // `String({})` は `[object Object]`。案内より目立つ位置に意味の無い1行が入る
    expect(screen.queryByText(/技術的な内容/)).toBeNull();
    expect(screen.getByText("棋譜を開き直してください。")).toBeTruthy();
  });

  test("畳まれた範囲を名乗る", () => {
    // 同じ文言だと、内側の1枚を外しても外側が同じ画面で受けて退行が見えない
    render(<ErrorFallbackBody label={BOUNDARY_LABELS.analysis} error={null} reset={noop} />);

    expect(screen.getByText("解析を表示できませんでした。")).toBeTruthy();
  });
});

describe("FloatingErrorFallback の置き方", () => {
  test("器へ入る。流れの中には出さない", () => {
    // 流れの中の箱で置き換えると、親の grid の行や flex の列を1つ食って
    // 周りの部品が暗黙の行へ押し出される
    const { container } = render(
      <FloatingErrorFallback label={BOUNDARY_LABELS.modal} error={null} reset={noop} />,
    );

    expect(container.querySelector(".error-fallback"), "呼び出し元の流れに残っている").toBeNull();
    const overlay = document.getElementById(OVERLAY_ROOT_ID);
    expect(overlay?.querySelector(".error-fallback")).not.toBeNull();
  });

  test("2枚出しても、同じ器に並んで入る", () => {
    // **重なりは器が決める。** 1枚ずつに座標を持たせると同時に出たときに同じ位置へ重なり、
    // 後から描かれた側が不透明な面で下の1枚を丸ごと覆う（名乗りも出口も読めず押せない）
    render(
      <>
        <FloatingErrorFallback label={BOUNDARY_LABELS.modal} error={null} reset={noop} />
        <FloatingErrorFallback label={BOUNDARY_LABELS.updater} error={null} reset={noop} />
      </>,
    );

    const items = document
      .getElementById(OVERLAY_ROOT_ID)
      ?.querySelectorAll(".error-overlay__item");
    expect(items?.length).toBe(2);
  });

  test("閉じられる", () => {
    // `再表示` が効かない失敗では箱は自分から消えない。閉じる手段が無いと
    // そのセッションのあいだ他の部品を覆い続ける
    render(<FloatingErrorFallback label={BOUNDARY_LABELS.modal} error={null} reset={noop} />);

    fireEvent.click(screen.getByText("閉じる"));

    expect(document.querySelector(".error-fallback")).toBeNull();
  });

  test("閉じても子は描き直さない", () => {
    // 畳みを解くのは境界の `reset` だけ。閉じた箱が子を描き直すと同じ行で落ちて箱が戻る
    let renders = 0;
    function Counting(): never {
      renders += 1;
      throw new Error("落ちた");
    }

    render(
      <AppErrorBoundary
        label={BOUNDARY_LABELS.modal}
        fallback={(view) => <FloatingErrorFallback {...view} />}
      >
        <Counting />
      </AppErrorBoundary>,
    );
    const before = renders;

    fireEvent.click(screen.getByText("閉じる"));

    expect(renders).toBe(before);
  });

  test("流れの中に出す本文には閉じる出口が無い", () => {
    // in-flow の器は閉じても隙間が残るだけで、畳んだことが読めなくなる
    render(<ErrorFallbackBody label={BOUNDARY_LABELS.board} error={null} reset={noop} />);

    expect(screen.queryByText("閉じる")).toBeNull();
  });
});
