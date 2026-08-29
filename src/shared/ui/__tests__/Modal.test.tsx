// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import Modal from "@/shared/ui/Modal";
import Button from "@/shared/ui/Button/Button";
import FloatingNote from "@/shared/ui/floating-note/FloatingNote";

/**
 * モーダルは**開いたままフォーカスを失う**ことがある。フォーカスを持つ要素が
 * `disabled` になるとブラウザは blur し、行き先は `<body>` になる。
 * `#modal-root` は `#root` の後ろにあるので、そこからの Tab は
 * オーバーレイの裏のアプリ本体へ入っていく。
 *
 * マウント時にフォーカスを移すだけでは、この経路を通らない。
 */

beforeEach(() => {
  const root = document.createElement("div");
  root.id = "modal-root";
  document.body.append(root);
});

afterEach(() => {
  cleanup();
  document.getElementById("modal-root")?.remove();
});

describe("Modal のフォーカス", () => {
  test("開いたら中の押せるものへ移す", () => {
    render(
      <Modal onClose={vi.fn()} label="対話">
        <Button>閉じる</Button>
      </Modal>,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "閉じる" }));
  });

  /**
   * 開いている間にフォーカスが外へ出たら中へ戻す。`disabled` になった要素からの
   * blur も、Tab で末尾を越えたのも、行き着く先は「カードの外」で同じ。
   */
  test("フォーカスが外へ出たら中へ戻す", async () => {
    render(
      <>
        <button type="button">裏のボタン</button>
        <Modal onClose={vi.fn()} label="対話">
          <Button>閉じる</Button>
        </Modal>
      </>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "裏のボタン" }).focus();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "閉じる" }));
  });

  // 処理中のボタンは disabled なので、そこへ戻すとまた外へ出る
  test("処理中のボタンには戻さない", () => {
    render(
      <Modal onClose={vi.fn()} label="対話">
        <Button isLoading>保存中</Button>
        <input aria-label="名前" />
      </Modal>,
    );

    expect(document.activeElement).toBe(screen.getByLabelText("名前"));
  });

  /**
   * 重なりは特殊な状況ではない。作成フォームで既にある名前を出すと、その上に
   * 衝突ダイアログが載る。1枚ごとに独立して奪い返すと、`focus()` が同期で
   * イベントを撒き続けてマイクロタスクキューが空にならず、画面が固まる。
   */
  test("2枚重なっても、フォーカスを奪い合わない", async () => {
    const focusCalls = vi.spyOn(HTMLElement.prototype, "focus");

    render(
      <>
        <Modal onClose={vi.fn()} label="下">
          <Button>下のボタン</Button>
        </Modal>
        <Modal onClose={vi.fn()} label="上">
          <Button>上のボタン</Button>
        </Modal>
      </>,
    );

    const before = focusCalls.mock.calls.length;
    await act(async () => {
      // マイクロタスクを何度か流す。奪い合っていればここで発散する
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });

    expect(focusCalls.mock.calls.length - before).toBeLessThan(5);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "上のボタン" }));
    focusCalls.mockRestore();
  });

  test("重なっているとき、Escape で閉じるのは上の1枚だけ", () => {
    const closeLower = vi.fn();
    const closeUpper = vi.fn();

    render(
      <>
        <Modal onClose={closeLower} label="下">
          <Button>下のボタン</Button>
        </Modal>
        <Modal onClose={closeUpper} label="上">
          <Button>上のボタン</Button>
        </Modal>
      </>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeUpper).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
  });

  /**
   * 下にいる付箋は、盤を動かすたびに再描画される。そのときに重なりへ積み直すと
   * 自分が最上位へ登り直し、上のモーダルから Escape と閉じ込めを奪う。
   * `onClose={() => ...}` のようにその場で作る関数を渡すのは普通の書き方なので、
   * それだけで起きる形にしてはいけない
   */
  test("下のものが再描画されても、Escape で閉じるのは上の1枚のまま", () => {
    const closeNote = vi.fn();
    const closeModal = vi.fn();

    // 付箋とモーダルは別々の親の下にいる。付箋だけが再描画される
    const note = (tick: number) => (
      <FloatingNote open anchorEl={null} onClose={() => closeNote()} title={`付箋 ${tick}`}>
        <span>本文</span>
      </FloatingNote>
    );

    const noteView = render(note(0));
    render(
      <Modal onClose={closeModal} label="上">
        <Button>上のボタン</Button>
      </Modal>,
    );

    noteView.rerender(note(1));
    noteView.rerender(note(2));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closeNote).not.toHaveBeenCalled();
  });

  test("最初の要素から Shift+Tab で外へ出ない", () => {
    render(
      <Modal onClose={vi.fn()} label="対話">
        <Button>先頭</Button>
        <Button>末尾</Button>
      </Modal>,
    );

    const first = screen.getByRole("button", { name: "先頭" });
    const last = screen.getByRole("button", { name: "末尾" });
    act(() => first.focus());

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(last);
  });
});
