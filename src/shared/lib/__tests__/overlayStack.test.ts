// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOverlayLayer } from "../overlayStack";

/**
 * Escape とフォーカスの閉じ込めは最上位の1つだけが扱う。
 * 独立させると、1回の Escape で重なっている全部が閉じる
 * （`preventDefault()` は伝播を止めない）。
 */

describe("useOverlayLayer", () => {
  it("最後に開いたものだけが最上位", () => {
    const lower = renderHook(() => useOverlayLayer(true));
    expect(lower.result.current()).toBe(true);

    const upper = renderHook(() => useOverlayLayer(true));
    expect(upper.result.current()).toBe(true);
    expect(lower.result.current()).toBe(false);

    upper.unmount();
    expect(lower.result.current()).toBe(true);
    lower.unmount();
  });

  it("閉じている間は順序に載らない", () => {
    const closed = renderHook(({ open }) => useOverlayLayer(open), {
      initialProps: { open: false },
    });
    const opened = renderHook(() => useOverlayLayer(true));

    expect(closed.result.current()).toBe(false);
    expect(opened.result.current()).toBe(true);

    closed.rerender({ open: true });
    expect(closed.result.current()).toBe(true);
    expect(opened.result.current()).toBe(false);

    closed.unmount();
    opened.unmount();
  });

  // 親が再描画するたびに積み直すと、下にいたものが最上位へ登り直し、
  // 上のモーダルから Escape と閉じ込めを奪う。`onClose={() => ...}` を
  // 依存に入れるだけでそうなるので、hook の側で依存を固定してある
  it("再描画では順序が動かない", () => {
    const lower = renderHook(() => useOverlayLayer(true));
    const upper = renderHook(() => useOverlayLayer(true));

    lower.rerender();
    lower.rerender();

    expect(upper.result.current()).toBe(true);
    expect(lower.result.current()).toBe(false);

    upper.unmount();
    lower.unmount();
  });

  it("途中のものを閉じても、残りの順序は崩れない", () => {
    const a = renderHook(() => useOverlayLayer(true));
    const b = renderHook(() => useOverlayLayer(true));
    const c = renderHook(() => useOverlayLayer(true));

    b.unmount();

    expect(c.result.current()).toBe(true);
    c.unmount();
    expect(a.result.current()).toBe(true);
    a.unmount();
    expect(a.result.current()).toBe(false);
  });
});
