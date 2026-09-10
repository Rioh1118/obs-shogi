// @vitest-environment happy-dom
import { describe, expect, test, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Color } from "shogi.js";
import { emptyHand } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import PositionEditor from "../PositionEditor";

/**
 * 掴んで置く（状態遷移表の B0 / B1 / B2 × X1 / X2）。
 *
 * **数えるのは「置き場3つの合計」。** 盤と両駒台を合わせた枚数が操作で変わるなら、
 * どこにも無い駒が生まれている。玉の入れ替えのように駒台を経由しない操作でも、
 * この合計は動かない。
 */

afterEach(cleanup);

/** 種を載せてから確かめる。**種を載せる経路そのものを通す**（prop で差し込まない） */
function renderSeeded(state: JKFState) {
  render(<PositionEditor currentPosition={state} />);
  fireEvent.click(screen.getByRole("button", { name: "いまの棋譜の局面" }));
}

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

const hasPiece = (x: number, y: number): boolean => square(x, y).querySelector(".piece") !== null;
const stackCount = (color: Color, kind: string): number =>
  stand(color).querySelectorAll(`.pos-editor__stack[data-kind="${kind}"] .pos-editor__stack-piece`)
    .length;

/** 盤と両駒台を合わせた枚数 */
const totalPieces = (): number =>
  document.querySelectorAll(".pos-editor__square .piece").length +
  document.querySelectorAll(".pos-editor__stack-piece").length;

const isHeld = (el: HTMLElement): boolean =>
  el.classList.contains("pos-editor__square--from") ||
  el.classList.contains("pos-editor__stack--held");

describe("盤の駒を掴んで置く", () => {
  test("空升を押しても掴めない", () => {
    render(<PositionEditor />);
    fireEvent.click(square(5, 5));
    expect(isHeld(square(5, 5))).toBe(false);
  });

  test("駒のある升を押すと掴む", () => {
    render(<PositionEditor />);
    fireEvent.click(square(7, 7));
    expect(isHeld(square(7, 7))).toBe(true);
  });

  test("掴んだ駒は盤から消えない", () => {
    // 消すと、どこから持ったのかを見失う。戻す口が無いので致命的
    render(<PositionEditor />);
    fireEvent.click(square(7, 7));
    expect(hasPiece(7, 7)).toBe(true);
    expect(totalPieces()).toBe(40);
  });

  test("同じ升をもう一度押すと離す", () => {
    render(<PositionEditor />);
    fireEvent.click(square(7, 7));
    fireEvent.click(square(7, 7));
    expect(isHeld(square(7, 7))).toBe(false);
    expect(hasPiece(7, 7)).toBe(true);
  });

  test("別の空升を押すと動く", () => {
    render(<PositionEditor />);
    fireEvent.click(square(7, 7));
    fireEvent.click(square(7, 6));
    expect(hasPiece(7, 7)).toBe(false);
    expect(hasPiece(7, 6)).toBe(true);
    expect(totalPieces()).toBe(40);
  });

  test("駒に重ねると、動かした側の駒台へ入る", () => {
    render(<PositionEditor />);
    fireEvent.click(square(2, 8)); // 先手の飛
    fireEvent.click(square(2, 7)); // 先手の歩に重ねる
    expect(stackCount(Color.Black, "FU")).toBe(1);
    expect(stackCount(Color.White, "FU")).toBe(0);
    expect(totalPieces()).toBe(40);
  });

  test("玉に重ねると入れ替わる。駒台には入らない", () => {
    render(<PositionEditor />);
    fireEvent.click(square(2, 8)); // 先手の飛
    fireEvent.click(square(5, 1)); // 後手の玉
    expect(totalPieces()).toBe(40);
    expect(document.querySelectorAll(".pos-editor__stack-piece")).toHaveLength(0);
    expect(hasPiece(2, 8)).toBe(true);
    expect(hasPiece(5, 1)).toBe(true);
  });
});

describe("盤から駒台へ送る", () => {
  test("駒台を押すと送れる", () => {
    render(<PositionEditor />);
    fireEvent.click(square(7, 7));
    fireEvent.click(stand(Color.Black));
    expect(hasPiece(7, 7)).toBe(false);
    expect(stackCount(Color.Black, "FU")).toBe(1);
    expect(totalPieces()).toBe(40);
  });

  test("相手の駒台へも送れる", () => {
    // 送り先は押した駒台であって、駒の持ち主ではない
    render(<PositionEditor />);
    fireEvent.click(square(7, 7));
    fireEvent.click(stand(Color.White));
    expect(stackCount(Color.White, "FU")).toBe(1);
    expect(stackCount(Color.Black, "FU")).toBe(0);
  });

  test("玉は駒台へ送れない。掴んだままにする", () => {
    render(<PositionEditor />);
    fireEvent.click(square(5, 9)); // 先手の玉
    fireEvent.click(stand(Color.Black));
    expect(hasPiece(5, 9)).toBe(true);
    expect(totalPieces()).toBe(40);
    // 離してしまうと「押したので何かが起きた」に見える。掴んだままにする
    expect(isHeld(square(5, 9))).toBe(true);
  });
});

describe("駒台の駒を掴んで置く", () => {
  function withHand(): JKFState {
    const state = emptyState();
    state.hands[Color.Black].FU = 2;
    state.board[4][8] = { kind: "OU", color: Color.Black };
    return state;
  }

  test("駒台の駒を押すと掴む", () => {
    renderSeeded(withHand());
    fireEvent.click(stack(Color.Black, "FU"));
    expect(isHeld(stack(Color.Black, "FU"))).toBe(true);
  });

  test("空升へ置ける", () => {
    renderSeeded(withHand());
    fireEvent.click(stack(Color.Black, "FU"));
    fireEvent.click(square(5, 5));
    expect(hasPiece(5, 5)).toBe(true);
    expect(stackCount(Color.Black, "FU")).toBe(1);
    expect(totalPieces()).toBe(3);
  });

  test("駒のある升へは置けない", () => {
    renderSeeded(withHand());
    fireEvent.click(stack(Color.Black, "FU"));
    fireEvent.click(square(5, 9)); // 玉がいる
    expect(stackCount(Color.Black, "FU")).toBe(2);
    expect(totalPieces()).toBe(3);
  });

  test("同じ駒台をもう一度押すと離す", () => {
    renderSeeded(withHand());
    fireEvent.click(stack(Color.Black, "FU"));
    fireEvent.click(stand(Color.Black));
    expect(isHeld(stack(Color.Black, "FU"))).toBe(false);
    expect(stackCount(Color.Black, "FU")).toBe(2);
  });

  test("反対の駒台を押すと移る", () => {
    renderSeeded(withHand());
    fireEvent.click(stack(Color.Black, "FU"));
    fireEvent.click(stand(Color.White));
    expect(stackCount(Color.Black, "FU")).toBe(1);
    expect(stackCount(Color.White, "FU")).toBe(1);
    expect(totalPieces()).toBe(3);
  });

  test("駒台の中の駒を押しても、掴んでいる間は「その駒台へ置く」になる", () => {
    // 駒の上を押したか駒台の余白を押したかで意味が変わると、
    // 同じ場所を押しているのに結果が違う画面になる
    const state = emptyState();
    state.hands[Color.Black].FU = 1;
    state.hands[Color.White].KI = 1;
    renderSeeded(state);

    fireEvent.click(stack(Color.Black, "FU"));
    fireEvent.click(stack(Color.White, "KI"));
    expect(stackCount(Color.White, "FU")).toBe(1);
    expect(stackCount(Color.Black, "FU")).toBe(0);
  });
});
