// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useBesidePlacement } from "../useBesidePlacement";

/**
 * 行の横のサーフェスは、開いている間に画面の大きさが変わったら置き直す。
 *
 * 置き直さないと、ウィンドウを狭めたときにサーフェスが画面の右へはみ出したまま残り、項目が押せなくなる。
 */

const anchor = { top: 100, left: 100, right: 300, bottom: 120, width: 200, height: 20 } as DOMRect;

function Popover() {
  const { selfRef, placement } = useBesidePlacement(true, anchor);
  return <div ref={selfRef} data-testid="pop" data-side={placement?.side ?? "none"} />;
}

async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(60);
  window.innerWidth = 800;
  window.innerHeight = 600;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("開いたら測って置き、画面が狭まったら置き直す", async () => {
  render(<Popover />);
  await nextFrame();
  expect(screen.getByTestId("pop").getAttribute("data-side")).toBe("right");

  window.innerWidth = 350;
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });

  expect(screen.getByTestId("pop").getAttribute("data-side")).toBe("left");
});
