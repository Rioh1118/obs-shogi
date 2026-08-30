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

/** 名前を直せば通る失敗。入力欄の下に出す */
const rejected = { ok: false as const, shown: BAD_NAME };
/** 通知が引き取る失敗。ここには出さないが、送り直しは止める */
const elsewhere = { ok: false as const, shown: undefined };
const passed = { ok: true as const };

afterEach(() => cleanup());

/**
 * 欄の下に出ている理由。
 *
 * **領域は常設**（空でも DOM にある）なので、`queryByRole("alert")` の有無では
 * 出ているかどうかを見られない。中身で見る
 */
function reasonText() {
  return screen.getByRole("alert").textContent;
}

function typeAndCommit(value: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value } });
  return act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

describe("InlineNameEditor", () => {
  test("失敗が返ったら理由を出し、打った文字列を残す", async () => {
    const onCommit = vi.fn().mockResolvedValue(rejected);
    render(
      <InlineNameEditor
        initialName="研究"
        onCommit={onCommit}
        onCancel={vi.fn()}
        onUnshowable={vi.fn()}
      />,
    );

    await typeAndCommit("研究/2026");

    expect(onCommit).toHaveBeenCalledWith("研究/2026");
    expect(screen.getByRole("alert").textContent).toBe("名前に / や \\ は使えません");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("研究/2026");
  });

  test("打ち直すと理由が消える。直したそばから古い理由が残らない", async () => {
    render(
      <InlineNameEditor
        initialName="研究"
        onCommit={vi.fn().mockResolvedValue(rejected)}
        onCancel={vi.fn()}
        onUnshowable={vi.fn()}
      />,
    );

    await typeAndCommit("研究/2026");
    expect(reasonText()).not.toBe("");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "研究2026" } });

    expect(reasonText()).toBe("");
  });

  /**
   * blur でも確定する。落ちた名前を送り直すと同じ失敗が戻るので、
   * 外をクリックしても表示が消えない状態になる。閉じる手段が無いまま
   * 行の上に貼り付き、下の行のクリックまで奪う。
   */
  test("落ちた名前を blur で送り直さない", async () => {
    const onCommit = vi.fn().mockResolvedValue(rejected);
    render(
      <InlineNameEditor
        initialName="研究"
        onCommit={onCommit}
        onCancel={vi.fn()}
        onUnshowable={vi.fn()}
      />,
    );

    await typeAndCommit("研究/2026");
    expect(onCommit).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.blur(screen.getByRole("textbox"));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  /**
   * Escape は入力欄にフォーカスがあるときしか届かない（失敗の箱は
   * `tabIndex` を持たないので焦点を取れない）。落ちた名前のまま外へ出たら、
   * 箱を残さず編集を閉じる。残すと閉じる手段が無くなる。
   */
  test("落ちた名前のまま外へ出たら、編集を閉じる", async () => {
    const onCancel = vi.fn();
    render(
      <InlineNameEditor
        initialName="研究"
        onCommit={vi.fn().mockResolvedValue(rejected)}
        onCancel={onCancel}
        onUnshowable={vi.fn()}
      />,
    );

    await typeAndCommit("研究/2026");
    await act(async () => {
      fireEvent.blur(screen.getByRole("textbox"));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // 一番普通の操作。打って外をクリックすると blur が確定の引き金になる。
  // ここで閉じると打った文字列ごと消え、「直すための入力欄が、直せという知らせに
  // 巻き込まれて消える」形になる。焦点は戻さない（状態遷移表の E4 を許す）
  test("打って外をクリックし、それが失敗しても閉じずに理由を出す", async () => {
    const onCommit = vi.fn().mockResolvedValue(rejected);
    const onCancel = vi.fn();

    render(
      <InlineNameEditor
        initialName=""
        onCommit={onCommit}
        onCancel={onCancel}
        onUnshowable={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "2026/08" } });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("2026/08");
  });

  /**
   * 状態遷移表の E2 → blur。**焦点は動かさない。**
   *
   * 確定は click より前のマイクロタスクで返るので、ここで `focus()` を呼ぶと
   * 利用者が移った先から焦点を奪い返す。押した行は開くのにキーボードは
   * 改名欄に残り、しかも入力欄は `onKeyDown` で全て `stopPropagation()` するので
   * Escape が他の受け口へ届かなくなる。
   *
   * **焦点を実際に動かして測る。** `fireEvent.blur` は happy-dom の
   * `document.activeElement` を動かさないので、それだけでは
   * 「欄に焦点がある」が成立しようのない条件になり、検査が空振りする。
   */
  test("送信中に外へ出て、そのあと失敗しても焦点を奪い返さない", async () => {
    let settle: (outcome: typeof rejected) => void = () => {};
    const onCommit = vi.fn(
      () =>
        new Promise<typeof rejected>((resolve) => {
          settle = resolve;
        }),
    );
    const onCancel = vi.fn();

    const elsewhereButton = document.createElement("button");
    document.body.appendChild(elsewhereButton);

    render(
      <InlineNameEditor
        initialName="a.kif"
        onCommit={onCommit}
        onCancel={onCancel}
        onUnshowable={vi.fn()}
      />,
    );

    // マウント時の `requestAnimationFrame` が欄へ焦点を置く。先に流しておかないと、
    // このあとの焦点移動をそれが上書きする
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "a/b.kif" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // 利用者が別の対話可能な要素へ移った。blur はその結果として起きる
    elsewhereButton.focus();

    await act(async () => {
      settle(rejected);
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(elsewhereButton);
    // 閉じない。打った文字列と理由は欄に残す
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("a/b.kif");

    elsewhereButton.remove();
  });

  // 名前の失敗は provider が通知へ積まない（出す責任がこの欄だけにある）。
  // 欄がもう無いときに捨てると、どの出口にも出ないまま終わる
  test("欄がもう無いなら、出せなかった失敗を呼び出し元へ返す", async () => {
    let settle: (outcome: typeof rejected) => void = () => {};
    const onCommit = vi.fn(
      () =>
        new Promise<typeof rejected>((resolve) => {
          settle = resolve;
        }),
    );
    const onUnshowable = vi.fn();

    const view = render(
      <InlineNameEditor
        initialName="a.kif"
        onCommit={onCommit}
        onCancel={vi.fn()}
        onUnshowable={onUnshowable}
      />,
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a/b.kif" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    // 呼び出し側が畳んだ（reducer の `case "error"` など）
    view.unmount();

    await act(async () => {
      settle(rejected);
      await Promise.resolve();
    });

    expect(onUnshowable).toHaveBeenCalledWith(BAD_NAME);
  });

  test("ここに出さない失敗でも、同じ名前を送り直さない", async () => {
    const onCommit = vi.fn().mockResolvedValue(elsewhere);
    render(
      <InlineNameEditor
        initialName="研究"
        onCommit={onCommit}
        onCancel={vi.fn()}
        onUnshowable={vi.fn()}
      />,
    );

    await typeAndCommit("研究2026");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(reasonText()).toBe("");

    await act(async () => {
      fireEvent.blur(screen.getByRole("textbox"));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test("通った名前では理由を出さない", async () => {
    const onCommit = vi.fn().mockResolvedValue(passed);
    render(
      <InlineNameEditor
        initialName="研究"
        onCommit={onCommit}
        onCancel={vi.fn()}
        onUnshowable={vi.fn()}
      />,
    );

    await typeAndCommit("研究2026");

    expect(reasonText()).toBe("");
  });

  test("空にして確定したら、失敗ではなく取り消しとして扱う", async () => {
    const onCommit = vi.fn().mockResolvedValue(passed);
    const onCancel = vi.fn();
    render(
      <InlineNameEditor
        initialName="研究"
        onCommit={onCommit}
        onCancel={onCancel}
        onUnshowable={vi.fn()}
      />,
    );

    await typeAndCommit("   ");

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
