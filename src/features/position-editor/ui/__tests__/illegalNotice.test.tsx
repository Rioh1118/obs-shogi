// @vitest-environment happy-dom
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Color } from "shogi.js";
import { emptyHand } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { EditorHarness, renderSeeded } from "./harness";

/**
 * 規則に反する配置の断り（状態遷移表の直交軸「断り」）。
 *
 * 何を挙げるかは `inspectPosition` のテストが固定している。ここが見るのは
 * **断りが遷移を変えないこと** —— 出ていても盤は触れるし、升の枠も付く。
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

const notice = (): HTMLElement | null => document.querySelector(".notice");
const illegal = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".pos-editor__square--illegal"),
];

/** 二歩の局面。5筋に先手の歩が2枚 */
function nifuState(): JKFState {
  const state = emptyState();
  state.board[4][4] = { kind: "FU", color: Color.Black };
  state.board[4][6] = { kind: "FU", color: Color.Black };
  return state;
}

describe("断り", () => {
  test("平手には出ない", () => {
    render(<EditorHarness />);
    expect(notice()).toBeNull();
    expect(illegal()).toHaveLength(0);
  });

  test("二歩で出る", () => {
    renderSeeded(nifuState());
    expect(screen.getByText("規則に反する配置があります。")).toBeTruthy();
    expect(screen.getByText(/5筋に先手の歩が2枚あります（二歩）/)).toBeTruthy();
  });

  test("該当する升に枠が付く", () => {
    renderSeeded(nifuState());
    const marked = illegal().map((el) => `${el.dataset.x},${el.dataset.y}`);
    expect(marked.sort()).toEqual(["5,5", "5,7"]);
  });

  test("段は danger", () => {
    // 同じ操作を繰り返しても直らず、直し方は配置ごとに違う（ADR-0004 決定1）
    renderSeeded(nifuState());
    expect(notice()!.classList.contains("notice--danger")).toBe(true);
  });

  test("押して直るボタンを付けない", () => {
    renderSeeded(nifuState());
    expect(notice()!.querySelector(".notice__actions")).toBeNull();
  });

  test("複数の理由を並べても、1つずつ読める", () => {
    // 改行が空白に潰れると全部が1文につながり、何件あるのか読めなくなる
    const state = nifuState();
    state.board[3][0] = { kind: "KY", color: Color.Black }; // 4一 香
    renderSeeded(state);

    const text = notice()!.querySelector(".notice__text")!.textContent!;
    expect(text.split("\n")).toHaveLength(2);
  });

  test("断りが出ていても盤は触れる", () => {
    // **止めない。通す。** 押せなくすると詰将棋が作れない
    renderSeeded(nifuState());
    fireEvent.click(square(5, 5));
    expect(square(5, 5).classList.contains("pos-editor__square--from")).toBe(true);
  });

  test("配置を直すと消える", () => {
    renderSeeded(nifuState());
    expect(notice()).not.toBeNull();

    fireEvent.click(square(5, 5));
    fireEvent.click(square(4, 5)); // 4筋へ動かせば二歩でなくなる

    expect(notice()).toBeNull();
    expect(illegal()).toHaveLength(0);
  });

  test("枠は面を塗らない。掴んでいる升の残像と両立する", () => {
    renderSeeded(nifuState());
    fireEvent.click(square(5, 5));

    expect(square(5, 5).classList.contains("pos-editor__square--illegal")).toBe(true);
    expect(square(5, 5).classList.contains("pos-editor__square--from")).toBe(true);
  });

  test("盤が空でも出る", () => {
    renderSeeded(emptyState());
    expect(screen.getByText(/盤に駒が1枚もありません/)).toBeTruthy();
  });
});
