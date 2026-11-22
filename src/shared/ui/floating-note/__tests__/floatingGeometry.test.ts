// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { computeAnchoredPos } from "../floatingGeometry";

/**
 * 開いた要素に対する付箋の位置。要素が画面の中にあるときと、一覧が流れて外へ出たとき。
 */

const VIEWPORT = { width: 1000, height: 800 };

function anchorAt(top: number, height = 30): HTMLElement {
  const anchor = document.createElement("button");
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + height,
    left: 600,
    right: 640,
    width: 40,
    height,
    x: 600,
    y: top,
    toJSON: () => ({}),
  });
  return anchor;
}

beforeEach(() => {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(VIEWPORT.width);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(VIEWPORT.height);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("要素が画面の中にあるとき", () => {
  test("下に収まれば、下に置く", () => {
    expect(computeAnchoredPos(anchorAt(100), 300)).toEqual({
      left: 600,
      top: 138,
      maxHeight: 654,
      placement: "bottom",
    });
  });

  test("下に収まらず上の方が広ければ、上に置く", () => {
    expect(computeAnchoredPos(anchorAt(700), 300)).toEqual({
      left: 600,
      bottom: 108,
      maxHeight: 684,
      placement: "top",
    });
  });
});

describe("一覧が流れて、要素が画面の外へ出たとき", () => {
  test("上へ出たら、画面の上端に残す", () => {
    expect(computeAnchoredPos(anchorAt(-3000), 300)).toEqual({
      left: 600,
      top: 8,
      maxHeight: 784,
      placement: "bottom",
    });
  });

  test("下へ出たら、画面の下端に残す", () => {
    expect(computeAnchoredPos(anchorAt(5000), 300)).toEqual({
      left: 600,
      bottom: 8,
      maxHeight: 784,
      placement: "top",
    });
  });
});
