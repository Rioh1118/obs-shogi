// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import NodeName from "../NodeName";

/**
 * ツリーの行の名前。入りきらないときに省くのは拡張子の手前で、全文は吹き出しで読める。
 *
 * happy-dom は寸法が0なので、入りきらないことは `scrollWidth` を差し替えて作る。
 */

const tooltip = () => document.getElementById("filetree-tooltip")!;
const parts = (container: HTMLElement) => ({
  stem: container.querySelector(".node-name__stem")?.textContent,
  ext: container.querySelector(".node-name__ext")?.textContent,
});

let shown: string[];

beforeEach(() => {
  shown = [];
  const pop = document.createElement("div");
  pop.id = "filetree-tooltip";
  Object.assign(pop, {
    showPopover: () => void shown.push(pop.textContent ?? ""),
    hidePopover: () => void shown.push("閉じた"),
  });
  document.body.append(pop);
});

afterEach(() => {
  cleanup();
  tooltip().remove();
  vi.restoreAllMocks();
});

/** 拡張子の手前が、入る幅を超えている */
function overflow() {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
}

describe("拡張子", () => {
  test("ファイルは、拡張子を別の箱に入れて省かない", () => {
    const { container } = render(<NodeName name="角換わり.kif" isFile />);

    expect(parts(container)).toEqual({ stem: "角換わり", ext: ".kif" });
  });

  test("区切りが2つあれば、最後から先が拡張子", () => {
    const { container } = render(<NodeName name="第1局.2026.csa" isFile />);

    expect(parts(container)).toEqual({ stem: "第1局.2026", ext: ".csa" });
  });

  test.each([
    ["拡張子が無い", "メモ", true],
    ["先頭が `.`", ".gitkeep", true],
    ["フォルダ", "2026.11", false],
  ])("%s なら、分けない", (_, name, isFile) => {
    const { container } = render(<NodeName name={name} isFile={isFile} />);

    expect(parts(container)).toEqual({ stem: name, ext: undefined });
  });
});

describe("吹き出し", () => {
  const enter = (container: HTMLElement) =>
    fireEvent.pointerEnter(container.querySelector(".node-name")!);

  test("入りきらない名前を指すと、全文を出す", () => {
    overflow();
    const { container } = render(<NodeName name="長い名前の棋譜.kif" isFile />);

    enter(container);

    expect(shown).toEqual(["長い名前の棋譜.kif"]);
  });

  test("入っていれば出さない", () => {
    const { container } = render(<NodeName name="短い.kif" isFile />);

    enter(container);

    expect(shown).toEqual([]);
  });

  test("掴んで動かしている間は出さない", () => {
    overflow();
    const { container } = render(<NodeName name="長い名前の棋譜.kif" isFile isDragging />);

    enter(container);

    expect(shown).toEqual([]);
  });

  test("外れると閉じる", () => {
    overflow();
    const { container } = render(<NodeName name="長い名前の棋譜.kif" isFile />);

    enter(container);
    fireEvent.pointerLeave(container.querySelector(".node-name")!);

    expect(shown).toEqual(["長い名前の棋譜.kif", "閉じた"]);
  });

  test("下端の行でも、画面の中に出す", () => {
    overflow();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 10,
      bottom: window.innerHeight,
    } as DOMRect);
    const { container } = render(<NodeName name="長い名前の棋譜.kif" isFile />);

    enter(container);

    expect(Number.parseFloat(tooltip().style.top) + 40).toBeLessThanOrEqual(window.innerHeight);
  });
});
