// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FsError } from "@/entities/file-tree";
import { KifuReadErrorDialog } from "../KifuReadErrorDialog";

/**
 * 棋譜を開けなかったことを伝える対話。見出しとファイル名、コピー、閉じるを見る。
 *
 * コピーした文は利用者が報告に貼る。欄が欠けると、どの棋譜で何が起きたかを
 * 開発者が辿れない。
 */

const ERROR: FsError = {
  code: "io",
  message: "read failed",
  path: "/w/sub/game.kif",
  cause: "disk gone",
};

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function pressCopy() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "エラーをコピー" }));
  });
}

describe("出すもの", () => {
  test("失敗が無ければ何も描かない", () => {
    const { container } = render(<KifuReadErrorDialog error={null} onDismiss={vi.fn()} />);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("棋譜を開けませんでした")).toBeNull();
  });

  test("見出しとファイル名を出す", () => {
    render(<KifuReadErrorDialog error={ERROR} onDismiss={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "棋譜を開けませんでした" })).toBeTruthy();
    expect(screen.getByText("game.kif")).toBeTruthy();
  });

  test("Windows の区切りでもファイル名だけを出す", () => {
    render(
      <KifuReadErrorDialog error={{ ...ERROR, path: "C:\\w\\sub\\win.kif" }} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText("win.kif")).toBeTruthy();
  });

  test("パスが無ければファイル名の行を出さない", () => {
    const { container } = render(
      <KifuReadErrorDialog error={{ ...ERROR, path: null }} onDismiss={vi.fn()} />,
    );

    expect(container.ownerDocument.querySelector(".kifuReadError__file")).toBeNull();
  });

  test("閉じるを押すと呼び手へ返す", () => {
    const onDismiss = vi.fn();
    render(<KifuReadErrorDialog error={ERROR} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("エラーをコピー", () => {
  test("code、message、file、cause を整形して写す", async () => {
    render(<KifuReadErrorDialog error={ERROR} onDismiss={vi.fn()} />);

    await pressCopy();

    expect(writeText).toHaveBeenCalledWith(
      [
        "[棋譜読み込みエラー]",
        "code: io",
        "message: read failed",
        "file: /w/sub/game.kif",
        "\ncause:\ndisk gone",
      ].join("\n"),
    );
  });

  test("パスと原因が無ければ、その行を写さない", async () => {
    render(
      <KifuReadErrorDialog error={{ code: "io", message: "read failed" }} onDismiss={vi.fn()} />,
    );

    await pressCopy();

    expect(writeText).toHaveBeenCalledWith("[棋譜読み込みエラー]\ncode: io\nmessage: read failed");
  });

  test("写せたら2秒だけ「コピーしました」を出す", async () => {
    vi.useFakeTimers();
    render(<KifuReadErrorDialog error={ERROR} onDismiss={vi.fn()} />);

    await pressCopy();
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("button", { name: "エラーをコピー" })).toBeTruthy();
  });

  test("写せなければ「コピーしました」を出さない", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<KifuReadErrorDialog error={ERROR} onDismiss={vi.fn()} />);

    await pressCopy();

    expect(screen.getByRole("button", { name: "エラーをコピー" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "コピーしました" })).toBeNull();
  });

  test("別の失敗が来たら「コピーしました」を消す", async () => {
    const { rerender } = render(<KifuReadErrorDialog error={ERROR} onDismiss={vi.fn()} />);
    await pressCopy();
    expect(screen.getByRole("button", { name: "コピーしました" })).toBeTruthy();

    rerender(
      <KifuReadErrorDialog error={{ ...ERROR, path: "/w/other.kif" }} onDismiss={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "エラーをコピー" })).toBeTruthy();
    expect(screen.getByText("other.kif")).toBeTruthy();
  });
});
