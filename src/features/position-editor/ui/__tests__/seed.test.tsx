// @vitest-environment happy-dom
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EditorHarness } from "./harness";

/**
 * 種を選ぶ（状態遷移表の X5）。
 *
 * **確定ボタンは無い。** 選んだ瞬間に載る。
 */

// 組む面はファイルを作る口（`useFileTree`）を持つ。ここで見たいのは盤の側なので、
// 保存先が無い状態に固定する（作成そのものは `createForm.test.tsx` が見る）
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile: vi.fn(), fileTree: null }),
}));

afterEach(cleanup);

const square = (x: number, y: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `.pos-editor__square[data-x="${x}"][data-y="${y}"]`,
  );
  if (!el) throw new Error(`升が無い: (${x}, ${y})`);
  return el;
};

const handicapButton = (): HTMLElement =>
  document.querySelector<HTMLElement>("#pos-editor-handicap")!;

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

  test("盤を触っても名前は消えない", () => {
    // **消すと「何をもとに組んだか」が画面から消える。** 平手を直した形なのか
    // 駒落ちを直した形なのかが読めなくなる
    render(<EditorHarness />);
    expect(handicapButton().textContent).toBe("平手");

    fireEvent.click(square(7, 7));
    fireEvent.click(square(7, 6));

    expect(handicapButton().textContent).toBe("平手");
  });

  test("手番を変えても名前は消えない", () => {
    render(<EditorHarness />);
    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(handicapButton().textContent).toBe("平手");
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
