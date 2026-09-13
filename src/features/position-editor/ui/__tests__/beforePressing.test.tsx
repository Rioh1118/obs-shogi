// @vitest-environment happy-dom
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Color } from "shogi.js";
import { emptyHand } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { EditorHarness, renderSeeded } from "./harness";

/**
 * 押す前に見せる（状態遷移表の不変条件2）。
 *
 * 判定そのものは `lib/boardMarks` のテストが固定している。ここが見るのは
 * **その判定が画面に着いているか** —— 印を計算していても、クラスを付け忘れれば
 * 「押しても何も起きない」がそのまま残る。
 */

// 組む面はファイルを作る口（`useFileTree`）を持つ。ここで見たいのは盤の側なので、
// 保存先が無い状態に固定する（作成そのものは `createForm.test.tsx` が見る）
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile: vi.fn(), fileTree: null }),
}));

afterEach(cleanup);

function emptyState(): JKFState {
  return {
    color: Color.Black,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({}))),
    hands: [emptyHand(), emptyHand()],
  };
}

const square = (x: number, y: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `.pos-editor__square[data-x="${x}"][data-y="${y}"]`,
  );
  if (!el) throw new Error(`升が無い: (${x}, ${y})`);
  return el;
};

const stand = (color: Color): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`.pos-editor__stand[data-color="${color}"]`);
  if (!el) throw new Error(`駒台が無い: ${color}`);
  return el;
};

const stack = (color: Color, kind: string): HTMLElement => {
  const el = stand(color).querySelector<HTMLElement>(`.pos-editor__stack[data-kind="${kind}"]`);
  if (!el) throw new Error(`駒台に ${kind} が無い: ${color}`);
  return el;
};

const ghost = (): HTMLElement | null => document.querySelector(".pos-editor__ghost");

const blockedSquares = (): number =>
  document.querySelectorAll(".pos-editor__square--blocked").length;

describe("沈める", () => {
  test("何も掴んでいなければ、沈む升は1つも無い", () => {
    // **休んでいる盤を沈めない。** 空升を押しても何も起きないが、そこで沈めると
    // 平手でも 41 升が黒くなり、盤が盤に見えなくなる
    render(<EditorHarness />);
    expect(blockedSquares()).toBe(0);
  });

  test("盤の駒を掴むと、沈む升が1つも無くなる", () => {
    // 空升へは動き、駒のある升には重なる。掴んだ升自身は「離す」
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    expect(blockedSquares()).toBe(0);
  });

  test("駒台の駒を掴むと、駒のある升が沈む", () => {
    const state = emptyState();
    state.hands[Color.Black].FU = 1;
    state.board[4][4] = { kind: "OU", color: Color.Black };
    renderSeeded(state);

    fireEvent.click(stack(Color.Black, "FU"));
    expect(blockedSquares()).toBe(1);
    expect(square(5, 5).classList.contains("pos-editor__square--blocked")).toBe(true);
  });

  test("玉を掴むと、両方の駒台が沈む", () => {
    render(<EditorHarness />);
    fireEvent.click(square(5, 9));
    expect(stand(Color.Black).classList.contains("pos-editor__stand--blocked")).toBe(true);
    expect(stand(Color.White).classList.contains("pos-editor__stand--blocked")).toBe(true);
  });

  test("空の駒台は、掴んでいなくても沈む", () => {
    render(<EditorHarness />);
    expect(stand(Color.Black).classList.contains("pos-editor__stand--blocked")).toBe(true);
  });
});

describe("光らせる", () => {
  test("盤の駒を掴んでいる間だけ、駒台が置き場として光る", () => {
    render(<EditorHarness />);
    expect(stand(Color.Black).classList.contains("pos-editor__stand--drop")).toBe(false);

    fireEvent.click(square(7, 7));
    expect(stand(Color.Black).classList.contains("pos-editor__stand--drop")).toBe(true);
    expect(stand(Color.White).classList.contains("pos-editor__stand--drop")).toBe(true);

    fireEvent.click(square(7, 7)); // 離す
    expect(stand(Color.Black).classList.contains("pos-editor__stand--drop")).toBe(false);
  });
});

describe("重ねる予告", () => {
  test("取る先にホバーすると、その升と行き先の駒台が名乗る", () => {
    render(<EditorHarness />);
    fireEvent.click(square(8, 8)); // 先手の角
    fireEvent.mouseEnter(square(2, 2)); // 後手の角

    expect(square(2, 2).classList.contains("pos-editor__square--takes")).toBe(true);
    expect(stand(Color.Black).classList.contains("pos-editor__stand--dest")).toBe(true);
    expect(stand(Color.White).classList.contains("pos-editor__stand--dest")).toBe(false);
  });

  test("玉にホバーすると、入れ替わる2つの升が名乗る", () => {
    render(<EditorHarness />);
    fireEvent.click(square(8, 8));
    fireEvent.mouseEnter(square(5, 1)); // 後手の玉

    expect(square(5, 1).classList.contains("pos-editor__square--swaps")).toBe(true);
    expect(square(8, 8).classList.contains("pos-editor__square--swaps")).toBe(true);
    expect(stand(Color.Black).classList.contains("pos-editor__stand--dest")).toBe(false);
  });

  test("盤から出ると予告が消える", () => {
    render(<EditorHarness />);
    fireEvent.click(square(8, 8));
    fireEvent.mouseEnter(square(2, 2));
    fireEvent.mouseLeave(document.querySelector(".pos-editor__board")!);

    expect(square(2, 2).classList.contains("pos-editor__square--takes")).toBe(false);
  });

  test("掴んでいなければホバーしても出ない", () => {
    render(<EditorHarness />);
    fireEvent.mouseEnter(square(2, 2));
    expect(square(2, 2).classList.contains("pos-editor__square--takes")).toBe(false);
  });
});

describe("ゴースト", () => {
  test("掴んでいない間は出さない", () => {
    render(<EditorHarness />);
    expect(ghost()).toBeNull();
  });

  test("掴むと出て、離すと消える", () => {
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    expect(ghost()).not.toBeNull();

    fireEvent.click(square(7, 7));
    expect(ghost()).toBeNull();
  });

  test("最初の mousemove まで出さない", () => {
    // 掴んだ時点のポインタ位置を知る口が無い。原点に描くと画面の隅で駒が光る
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    expect(ghost()!.classList.contains("pos-editor__ghost--placed")).toBe(false);

    fireEvent.mouseMove(window, { clientX: 120, clientY: 80 });
    expect(ghost()!.classList.contains("pos-editor__ghost--placed")).toBe(true);
  });

  test("ポインタに付いてくる", () => {
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));

    fireEvent.mouseMove(window, { clientX: 120, clientY: 80 });
    expect(ghost()!.style.left).toBe("120px");
    expect(ghost()!.style.top).toBe("80px");

    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 });
    expect(ghost()!.style.left).toBe("400px");
  });

  test("駒台から掴んだ駒もカーソルに付く", () => {
    const state = emptyState();
    state.hands[Color.White].KI = 1;
    renderSeeded(state);

    fireEvent.click(stack(Color.White, "KI"));
    expect(ghost()).not.toBeNull();
  });
});
