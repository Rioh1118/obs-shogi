// @vitest-environment happy-dom
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Color } from "shogi.js";
import { emptyHand } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { EditorHarness } from "./harness";

/**
 * 種を選ぶ（状態遷移表の X5 / X7）。
 *
 * **確定ボタンは無い。** 選んだ瞬間に載る。
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

const handicapButton = (): HTMLElement =>
  document.querySelector<HTMLElement>("#pos-editor-handicap")!;
const currentKifuButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: "いまの棋譜の局面" });

const pickHandicap = (label: string) => {
  fireEvent.click(handicapButton());
  fireEvent.click(screen.getByRole("option", { name: label }));
};

const boardPieces = (): number => document.querySelectorAll(".pos-editor__square .piece").length;

describe("開いた瞬間", () => {
  test("平手が並んでいる", () => {
    // **空盤から始めない。** 駒箱が無いので、空盤に置くと駒を1枚も足せない
    render(<EditorHarness />);
    expect(boardPieces()).toBe(40);
    expect(handicapButton().textContent).toBe("平手");
  });
});

describe("手合割から", () => {
  test("選んだ瞬間に載る。確定ボタンは無い", () => {
    render(<EditorHarness />);
    pickHandicap("二枚落ち");

    expect(boardPieces()).toBe(38);
    expect(screen.queryByRole("button", { name: "この手合割にする" })).toBeNull();
  });

  test("手番も種のものになる", () => {
    render(<EditorHarness />);
    pickHandicap("二枚落ち");
    expect(document.querySelector(".pos-editor__turn-value")!.textContent).toBe("☖後手");
  });

  test("盤を触るとプレースホルダに戻る", () => {
    // 値が残っていると、同じ手合割を選び直しても `onChange` が飛ばない
    render(<EditorHarness />);
    expect(handicapButton().textContent).toBe("平手");

    fireEvent.click(square(7, 7));
    fireEvent.click(square(7, 6));

    expect(handicapButton().textContent).toBe("手合割から…");
  });

  test("同じ手合割を選び直すと、確認を通ってから載せ直される", () => {
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    fireEvent.click(square(7, 6));
    expect(square(7, 7).querySelector(".piece")).toBeNull();

    pickHandicap("平手");
    // 組みかけなので、押した瞬間には載らない
    expect(square(7, 7).querySelector(".piece")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "捨てる" }));
    expect(square(7, 7).querySelector(".piece")).not.toBeNull();
    expect(handicapButton().textContent).toBe("平手");
  });
});

describe("いまの棋譜の局面から", () => {
  test("棋譜が無ければ押せない。理由をその場に残す", () => {
    // **押しても何も起きない形を作らない**
    render(<EditorHarness />);
    expect(currentKifuButton().disabled).toBe(true);
    expect(currentKifuButton().title).toBe("棋譜を開いていません");
  });

  test("棋譜があれば押せる", () => {
    render(<EditorHarness currentPosition={emptyState()} />);
    expect(currentKifuButton().disabled).toBe(false);
    expect(currentKifuButton().title).toBe("");
  });

  test("押すと載る", () => {
    const state = emptyState();
    state.board[4][4] = { kind: "OU", color: Color.Black };
    render(<EditorHarness currentPosition={state} />);

    fireEvent.click(currentKifuButton());
    expect(boardPieces()).toBe(1);
  });

  test("載せた後は手合割がプレースホルダになる", () => {
    // 棋譜の局面はどの手合割でもない
    render(<EditorHarness currentPosition={emptyState()} />);
    fireEvent.click(currentKifuButton());
    expect(handicapButton().textContent).toBe("手合割から…");
  });

  test("載せ直すと組みかけでなくなる", () => {
    const state = emptyState();
    state.board[4][4] = { kind: "OU", color: Color.Black };
    render(<EditorHarness currentPosition={state} />);

    fireEvent.click(currentKifuButton());
    fireEvent.click(square(5, 5));
    fireEvent.click(square(5, 4)); // 触って組みかけにする
    fireEvent.click(currentKifuButton());
    fireEvent.click(screen.getByRole("button", { name: "捨てる" }));

    expect(square(5, 5).querySelector(".piece")).not.toBeNull();
  });
});
