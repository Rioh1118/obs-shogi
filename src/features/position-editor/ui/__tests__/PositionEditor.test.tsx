// @vitest-environment happy-dom
import { describe, expect, test, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Color } from "shogi.js";
import { emptyHand, stateFromPreset } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import PositionEditor from "../PositionEditor";

/**
 * 組む面の描画。**触れるようにするのはこの後**（掴む・置く・裏返す）。
 *
 * ここで固定するのは、種を載せた局面が盤と駒台の3つの置き場に**全部載る**こと。
 * 載り切らないと、盤にも駒台にも出ない駒が生まれ、
 * 「40枚が必ずどこかにある」という置き場3つの前提が黙って崩れる。
 */

afterEach(cleanup);

function emptyState(): JKFState {
  return {
    color: Color.Black,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({}))),
    hands: [emptyHand(), emptyHand()],
  };
}

const squares = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".pos-editor__square"),
];
const piecesOnBoard = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".pos-editor__square .piece"),
];
const piecesInStands = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".pos-editor__stack-piece"),
];

describe("PositionEditor", () => {
  test("升は81個", () => {
    render(<PositionEditor state={emptyState()} />);
    expect(squares()).toHaveLength(81);
  });

  test("平手は40枚が盤に載る", () => {
    render(<PositionEditor state={stateFromPreset("HIRATE")} />);
    expect(piecesOnBoard()).toHaveLength(40);
    expect(piecesInStands()).toHaveLength(0);
  });

  test("駒落ちは落とした分だけ減り、駒台には出ない", () => {
    render(<PositionEditor state={stateFromPreset("2")} />);
    expect(piecesOnBoard()).toHaveLength(38);
    expect(piecesInStands()).toHaveLength(0);
  });

  test("左上の升が9一", () => {
    // 対局の盤と筋の向きが逆になっても、どちらも「盤に見える」ので目視では気づけない
    render(<PositionEditor state={emptyState()} />);
    const first = squares()[0]!;
    expect(first.dataset.x).toBe("9");
    expect(first.dataset.y).toBe("1");
  });

  test("駒台は先後で2つ", () => {
    render(<PositionEditor state={emptyState()} />);
    expect(document.querySelectorAll(".pos-editor__stand")).toHaveLength(2);
    expect(screen.getByText("☗先手の駒台")).toBeTruthy();
    expect(screen.getByText("☖後手の駒台")).toBeTruthy();
  });

  test("持ち駒は枚数のぶんだけ重ねて描く", () => {
    const state = emptyState();
    state.hands[Color.Black].FU = 3;
    state.hands[Color.White].KI = 2;
    render(<PositionEditor state={state} />);

    expect(piecesInStands()).toHaveLength(5);
  });

  test("持ち駒の枚数を数字で出さない", () => {
    // 数字を添えると、盤の駒と駒台の駒で「1枚がどう見えるか」が変わる
    const state = emptyState();
    state.hands[Color.Black].FU = 18;
    render(<PositionEditor state={state} />);

    expect(screen.queryByText(/18/)).toBeNull();
    expect(screen.queryByText(/×/)).toBeNull();
  });

  test("持ち駒が無い駒台は空のまま描かれる", () => {
    // 駒台そのものは消さない。消すと掴んでいる間に現れて、置き場の位置が動く
    render(<PositionEditor state={emptyState()} />);
    expect(document.querySelectorAll(".pos-editor__stand")).toHaveLength(2);
    expect(piecesInStands()).toHaveLength(0);
  });

  test("盤と駒台を合わせて、種の駒が1枚も欠けない", () => {
    const state = stateFromPreset("HIRATE");
    // 盤から2枚を両方の駒台へ送った形
    state.board[6][6] = {};
    state.board[2][2] = {};
    state.hands[Color.Black].FU = 1;
    state.hands[Color.White].FU = 1;

    render(<PositionEditor state={state} />);
    expect(piecesOnBoard().length + piecesInStands().length).toBe(40);
  });
});
