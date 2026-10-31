// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { SLOW_START_MS } from "@/entities/engine/lib/engineNotices";
import { useSlowStart } from "../useSlowStart";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("起動が長引いたか", () => {
  test("越えたら立ち、段を抜けたら倒れる", () => {
    vi.useFakeTimers();
    const view = renderHook(({ starting }) => useSlowStart(starting), {
      initialProps: { starting: true },
    });
    expect(view.result.current).toBe(false);

    act(() => void vi.advanceTimersByTime(SLOW_START_MS));
    expect(view.result.current).toBe(true);

    view.rerender({ starting: false });
    expect(view.result.current).toBe(false);
  });
});
