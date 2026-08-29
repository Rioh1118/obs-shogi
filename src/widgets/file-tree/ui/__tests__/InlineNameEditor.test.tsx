// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { FsError } from "@/entities/file-tree";
import InlineNameEditor from "../InlineNameEditor";

/**
 * 入力の訂正を求める失敗を通知として積むと、reducer が編集行ごと畳み、
 * **直すための入力欄が、直せという知らせに巻き込まれて消える**。
 * 打った文字列も一緒に捨てられるので、右クリックからやり直して全部打ち直すことになる。
 *
 * ここで固定するのは「失敗しても入力欄と打った文字列が残る」こと。
 */

const BAD_NAME: FsError = {
  code: "invalid_name_separator",
  message: "name contains a path separator",
};

afterEach(() => cleanup());

function typeAndCommit(value: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value } });
  return act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

describe("InlineNameEditor", () => {
  test("失敗が返ったら理由を出し、打った文字列を残す", async () => {
    const onCommit = vi.fn().mockResolvedValue(BAD_NAME);
    render(
      <InlineNameEditor isEditting initialName="研究" onCommit={onCommit} onCancel={vi.fn()} />,
    );

    await typeAndCommit("研究/2026");

    expect(onCommit).toHaveBeenCalledWith("研究/2026");
    expect(screen.getByRole("alert").textContent).toBe("名前に / や \\ は使えません");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("研究/2026");
  });

  test("打ち直すと理由が消える。直したそばから古い理由が残らない", async () => {
    render(
      <InlineNameEditor
        isEditting
        initialName="研究"
        onCommit={vi.fn().mockResolvedValue(BAD_NAME)}
        onCancel={vi.fn()}
      />,
    );

    await typeAndCommit("研究/2026");
    expect(screen.queryByRole("alert")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "研究2026" } });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * blur でも確定する。落ちた名前を送り直すと同じ失敗が戻るので、
   * 外をクリックしても表示が消えない状態になる。閉じる手段が無いまま
   * 行の上に貼り付き、下の行のクリックまで奪う。
   */
  test("落ちた名前を blur で送り直さない", async () => {
    const onCommit = vi.fn().mockResolvedValue(BAD_NAME);
    render(
      <InlineNameEditor isEditting initialName="研究" onCommit={onCommit} onCancel={vi.fn()} />,
    );

    await typeAndCommit("研究/2026");
    expect(onCommit).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.blur(screen.getByRole("textbox"));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test("フォーカスを外したあとでも Escape で閉じられる", async () => {
    const onCancel = vi.fn();
    render(
      <InlineNameEditor
        isEditting
        initialName="研究"
        onCommit={vi.fn().mockResolvedValue(BAD_NAME)}
        onCancel={onCancel}
      />,
    );

    await typeAndCommit("研究/2026");
    await act(async () => {
      fireEvent.blur(screen.getByRole("textbox"));
    });

    // 入力欄の外（失敗表示を含む箱）で押しても届く
    fireEvent.keyDown(screen.getByRole("alert"), { key: "Escape", bubbles: true });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("通った名前では理由を出さない", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineNameEditor isEditting initialName="研究" onCommit={onCommit} onCancel={vi.fn()} />,
    );

    await typeAndCommit("研究2026");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("空にして確定したら、失敗ではなく取り消しとして扱う", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <InlineNameEditor isEditting initialName="研究" onCommit={onCommit} onCancel={onCancel} />,
    );

    await typeAndCommit("   ");

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
