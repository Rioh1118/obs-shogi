import { describe, expect, it } from "vitest";
import { isTopOverlay, popOverlay, pushOverlay } from "../overlayStack";

/**
 * Escape とフォーカスの閉じ込めは最上位の1つだけが扱う。
 * 独立させると、1回の Escape で重なっている全部が閉じる
 * （`preventDefault()` は伝播を止めない）。
 */

describe("overlayStack", () => {
  it("最後に積んだものだけが最上位", () => {
    const lower = {};
    const upper = {};

    pushOverlay(lower);
    expect(isTopOverlay(lower)).toBe(true);

    pushOverlay(upper);
    expect(isTopOverlay(upper)).toBe(true);
    expect(isTopOverlay(lower)).toBe(false);

    popOverlay(upper);
    popOverlay(lower);
  });

  it("途中のものを外しても、残りの順序は崩れない", () => {
    const a = {};
    const b = {};
    const c = {};
    [a, b, c].forEach(pushOverlay);

    popOverlay(b);

    expect(isTopOverlay(c)).toBe(true);
    popOverlay(c);
    expect(isTopOverlay(a)).toBe(true);
    popOverlay(a);
  });

  it("積んでいないものを外しても壊れない", () => {
    const a = {};
    pushOverlay(a);

    popOverlay({});

    expect(isTopOverlay(a)).toBe(true);
    popOverlay(a);
    expect(isTopOverlay(a)).toBe(false);
  });
});
