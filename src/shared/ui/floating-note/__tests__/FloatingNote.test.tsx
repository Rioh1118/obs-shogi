// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FloatingNote from "../FloatingNote";

const PANEL = { top: 100, left: 200, width: 400, height: 300 };

function panelRect(): DOMRect {
  const { top, left, width, height } = PANEL;
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function renderNote(onClose = vi.fn(), onParentPointerDown = vi.fn()) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    ...panelRect(),
    top: 50,
    bottom: 80,
    left: 200,
  });

  render(
    <div onPointerDown={onParentPointerDown}>
      <FloatingNote
        open
        anchorEl={anchor}
        onClose={onClose}
        title="題"
        headerRight={<span>右の区画</span>}
      >
        本文
      </FloatingNote>
    </div>,
  );

  const panel = screen.getByRole("dialog");
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(panelRect());
  return panel;
}

function handle(panel: HTMLElement, edge: string): Element {
  const found = panel.querySelector(`.floating-note__resize--${edge}`);
  if (!found) throw new Error(`把手 ${edge} が無い`);
  return found;
}

function movePointer(clientX: number, clientY: number) {
  fireEvent(window, new MouseEvent("pointermove", { clientX, clientY }));
}

beforeEach(() => {
  window.innerWidth = 1200;
  window.innerHeight = 800;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("FloatingNote の位置", () => {
  it("開いた場所の下に置く", () => {
    const panel = renderNote();
    expect(panel.style.top).toBe("88px");
    expect(panel.style.left).toBe("200px");
    expect(panel.className).toContain("floating-note--bottom");
  });

  it("閉じていれば何も描かない", () => {
    render(
      <FloatingNote open={false} anchorEl={null} onClose={vi.fn()}>
        本文
      </FloatingNote>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FloatingNote のドラッグ", () => {
  it("動かした分だけ移し、大きさは変えない", () => {
    const panel = renderNote();

    fireEvent.pointerDown(panel.querySelector(".floating-note__drag-area")!, {
      button: 0,
      clientX: 300,
      clientY: 150,
    });
    expect(panel.className).toContain("floating-note--dragging");
    movePointer(330, 170);

    expect(panel.style.left).toBe("230px");
    expect(panel.style.top).toBe("120px");
    expect(panel.style.width).toBe("400px");
    expect(panel.style.height).toBe("300px");
  });

  it("画面の外へ出さない", () => {
    const panel = renderNote();

    fireEvent.pointerDown(panel.querySelector(".floating-note__drag-area")!, {
      button: 0,
      clientX: 300,
      clientY: 150,
    });
    movePointer(-5000, -5000);

    expect(panel.style.left).toBe("4px");
    expect(panel.style.top).toBe("4px");
  });

  it("離した後は動かない", () => {
    const panel = renderNote();

    fireEvent.pointerDown(panel.querySelector(".floating-note__drag-area")!, {
      button: 0,
      clientX: 300,
      clientY: 150,
    });
    movePointer(330, 170);
    fireEvent(window, new MouseEvent("pointerup"));
    movePointer(500, 500);

    expect(panel.style.left).toBe("230px");
    expect(panel.className).not.toContain("floating-note--dragging");
  });

  it("左のボタン以外では始まらない", () => {
    const panel = renderNote();

    fireEvent.pointerDown(panel.querySelector(".floating-note__drag-area")!, {
      button: 2,
      clientX: 300,
      clientY: 150,
    });
    movePointer(330, 170);

    expect(panel.style.left).toBe("200px");
  });
});

describe("FloatingNote のリサイズ", () => {
  it.each([
    ["e", 450, 150, { left: 200, top: 100, width: 550, height: 300 }],
    ["s", 300, 250, { left: 200, top: 100, width: 400, height: 400 }],
    ["w", 250, 150, { left: 150, top: 100, width: 450, height: 300 }],
    ["n", 300, 100, { left: 200, top: 50, width: 400, height: 350 }],
    ["se", 350, 200, { left: 200, top: 100, width: 450, height: 350 }],
    ["nw", 250, 100, { left: 150, top: 50, width: 450, height: 350 }],
    ["ne", 350, 100, { left: 200, top: 50, width: 450, height: 350 }],
    ["sw", 250, 200, { left: 150, top: 100, width: 450, height: 350 }],
  ])("%s の把手が動かす辺", (edge, clientX, clientY, expected) => {
    const panel = renderNote();

    fireEvent.pointerDown(handle(panel, edge), { button: 0, clientX: 300, clientY: 150 });
    movePointer(clientX, clientY);

    expect(panel.style.left).toBe(`${expected.left}px`);
    expect(panel.style.top).toBe(`${expected.top}px`);
    expect(panel.style.width).toBe(`${expected.width}px`);
    expect(panel.style.height).toBe(`${expected.height}px`);
  });

  it.each([
    ["e", { left: 200, top: 100, width: 450, height: 300 }],
    ["w", { left: 250, top: 100, width: 350, height: 300 }],
    ["n", { left: 200, top: 130, width: 400, height: 270 }],
    ["s", { left: 200, top: 100, width: 400, height: 330 }],
  ])("%s の把手は斜めに動かしても自分の辺だけを動かす", (edge, expected) => {
    const panel = renderNote();

    fireEvent.pointerDown(handle(panel, edge), { button: 0, clientX: 300, clientY: 150 });
    movePointer(350, 180);

    expect(panel.style.left).toBe(`${expected.left}px`);
    expect(panel.style.top).toBe(`${expected.top}px`);
    expect(panel.style.width).toBe(`${expected.width}px`);
    expect(panel.style.height).toBe(`${expected.height}px`);
  });

  it("下限より小さくしない", () => {
    const panel = renderNote();

    fireEvent.pointerDown(handle(panel, "se"), { button: 0, clientX: 300, clientY: 150 });
    movePointer(-2000, -2000);

    expect(panel.style.width).toBe("280px");
    expect(panel.style.height).toBe("180px");
  });

  it("把手の押下を React の親へ流さない", () => {
    const onParent = vi.fn();
    const panel = renderNote(vi.fn(), onParent);

    for (const edge of ["n", "ne", "nw", "e", "w", "s", "se", "sw"]) {
      fireEvent.pointerDown(handle(panel, edge), { button: 0, clientX: 300, clientY: 150 });
    }

    expect(onParent).not.toHaveBeenCalled();
  });
});

describe("FloatingNote の区画", () => {
  it("把手と区画の DOM の並びが変わらない", () => {
    const panel = renderNote();
    const shape = [...panel.children].map((child) =>
      child.className.replace("floating-note__resize floating-note__resize--", "resize:"),
    );
    expect(shape).toEqual([
      "floating-note__top-band",
      "floating-note__header",
      "floating-note__body",
      "resize:e",
      "resize:w",
      "resize:s",
      "resize:se",
      "resize:sw",
    ]);
    expect(
      [...panel.querySelector(".floating-note__top-band")!.children].map((child) =>
        child.className.replace("floating-note__resize floating-note__resize--", ""),
      ),
    ).toEqual(["nw", "n", "ne"]);
  });

  it("題と右の区画と本文を描く", () => {
    renderNote();
    expect(screen.getByText("題")).toBeTruthy();
    expect(screen.getByText("右の区画")).toBeTruthy();
    expect(screen.getByText("本文")).toBeTruthy();
  });

  it("閉じるボタンと Escape で閉じる", () => {
    const onClose = vi.fn();
    renderNote(onClose);

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
