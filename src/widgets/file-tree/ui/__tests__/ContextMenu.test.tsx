// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ContextMenu from "../ContextMenu";

/**
 * 右クリックのメニューの閉じ方。項目は削除の確認を開くので、
 * 押した項目が1回だけ走り、走った後に閉じることを固定する。
 */

afterEach(cleanup);

function open(items: Parameters<typeof ContextMenu>[0]["items"]) {
  const onClose = vi.fn();
  render(
    <>
      <button type="button">外</button>
      <ContextMenu x={10} y={20} items={items} onClose={onClose} />
    </>,
  );
  return onClose;
}

describe("ContextMenu", () => {
  test("項目を押すとその項目を走らせてから閉じる", async () => {
    const order: string[] = [];
    const onClick = vi.fn(() => {
      order.push("click");
    });
    const onClose = open([{ label: "Rename", onClick }]);
    onClose.mockImplementation(() => order.push("close"));

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["click", "close"]);
  });

  test("押せない項目は走らせず、閉じもしない", async () => {
    const onClick = vi.fn();
    const onClose = open([{ label: "Delete", onClick, disabled: true }]);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });

    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("外を押すと閉じ、中を押しても閉じない", () => {
    const onClose = open([{ label: "Rename", onClick: vi.fn() }]);

    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "外" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape で閉じる", () => {
    const onClose = open([{ label: "Rename", onClick: vi.fn() }]);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("危ない項目には印を付けて並べる", () => {
    open([
      { label: "Rename", onClick: vi.fn() },
      { label: "Delete", danger: true, onClick: vi.fn() },
    ]);

    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Rename",
      "Delete",
    ]);
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toContain(
      "context-menu__item--danger",
    );
  });
});
