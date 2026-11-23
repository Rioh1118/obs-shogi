// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  computeAnchoredPos,
  moveGeometry,
  resizeGeometry,
  topBandsBottom,
} from "../floatingGeometry";

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

/**
 * 付箋はタイトルバーより下に重なる。帯の上に置くと、見出しと閉じるボタンが隠れ、
 * 閉じるボタンの位置を押すと帯のボタンが押される
 */
describe("上の帯の下端より上には置かない", () => {
  const BANDS_BOTTOM = 78;
  const note = { top: 100, left: 100, width: 300, height: 200 };

  test("要素が帯の裏へ流れても、付箋は帯の下に置く", () => {
    expect(computeAnchoredPos(anchorAt(-3000), 300, BANDS_BOTTOM)).toMatchObject({
      top: BANDS_BOTTOM + 8,
      placement: "bottom",
    });
  });

  test("上に開くときも、帯の下端までの高さに収める", () => {
    expect(computeAnchoredPos(anchorAt(600), 300, BANDS_BOTTOM)).toMatchObject({
      bottom: VIEWPORT.height - 600 + 8,
      maxHeight: 600 - BANDS_BOTTOM - 16,
      placement: "top",
    });
  });

  test("掴んで上へ動かしても、帯の下で止まる", () => {
    expect(moveGeometry(note, { dx: 0, dy: -500 }, BANDS_BOTTOM).top).toBe(BANDS_BOTTOM + 4);
  });

  test("上の辺を広げても、帯の下で止まる", () => {
    expect(resizeGeometry(note, "n", { dx: 0, dy: -500 }, BANDS_BOTTOM).top).toBe(BANDS_BOTTOM + 4);
  });

  test("帯の下端は、タイトルバーの下端に、並ぶ帯の高さを足したもの", () => {
    const bar = document.createElement("div");
    bar.className = "titlebar";
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 38,
      left: 0,
      right: VIEWPORT.width,
      width: VIEWPORT.width,
      height: 38,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    document.body.append(bar);
    const { style } = document.documentElement;
    style.setProperty("--notice-bands-h", "40px");
    style.setProperty("--update-band-h", "36px");
    try {
      expect(topBandsBottom()).toBe(114);
    } finally {
      bar.remove();
      style.removeProperty("--notice-bands-h");
      style.removeProperty("--update-band-h");
    }
  });
});
