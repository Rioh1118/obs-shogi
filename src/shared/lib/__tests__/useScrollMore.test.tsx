// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";

import { useScrollMore } from "../useScrollMore";

/** 下に続きがあるかの目印。happy-dom は寸法が0なので、箱と中身の高さを差し替える */

const size = { scrollHeight: 0, clientHeight: 100 };

function List() {
  const ref = useRef<HTMLDivElement | null>(null);
  useScrollMore(ref);
  return <div ref={ref} data-testid="list" />;
}

function mount(scrollHeight: number) {
  size.scrollHeight = scrollHeight;
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    () => size.scrollHeight,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => size.clientHeight,
  );
  return render(<List />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const hasMore = (view: ReturnType<typeof mount>) =>
  view.getByTestId("list").hasAttribute("data-more");

describe("useScrollMore", () => {
  test("下に続きがあれば付ける", () => {
    expect(hasMore(mount(200))).toBe(true);
  });

  test.each([100, 108])("入りきっていれば（中身 %i）付けない", (scrollHeight) => {
    expect(hasMore(mount(scrollHeight))).toBe(false);
  });

  test("端まで送ると外し、戻すと付ける", () => {
    const view = mount(200);
    const list = view.getByTestId("list");

    list.scrollTop = 100;
    fireEvent.scroll(list);
    expect(hasMore(view)).toBe(false);

    list.scrollTop = 0;
    fireEvent.scroll(list);
    expect(hasMore(view)).toBe(true);
  });

  test("行が増えたら、描き直したときに見直す", () => {
    const view = mount(100);
    expect(hasMore(view)).toBe(false);

    size.scrollHeight = 200;
    view.rerender(<List />);

    expect(hasMore(view)).toBe(true);
  });

  test("消えた後は聞かない", () => {
    const view = mount(200);
    const list = view.getByTestId("list");
    view.unmount();

    list.scrollTop = 100;
    fireEvent.scroll(list);

    expect(list.hasAttribute("data-more")).toBe(true);
  });
});
