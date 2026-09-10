// @vitest-environment happy-dom
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { stateFromPreset } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { EditorHarness } from "./harness";

/** 手番（状態遷移表の X4）。盤の外の値なので、駒の位置は動かさない */

// 組む面はファイルを作る口（`useFileTree`）を持つ。ここで見たいのは盤の側なので、
// 保存先が無い状態に固定する（作成そのものは `createForm.test.tsx` が見る）
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile: vi.fn(), fileTree: null }),
}));

afterEach(cleanup);

/** 種を載せてから確かめる。**種を載せる経路そのものを通す**（prop で差し込まない） */
function renderSeeded(state: JKFState) {
  render(<EditorHarness currentPosition={state} />);
  fireEvent.click(screen.getByRole("button", { name: "いまの棋譜の局面" }));
}

const square = (x: number, y: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `.pos-editor__square[data-x="${x}"][data-y="${y}"]`,
  );
  if (!el) throw new Error(`升が無い: (${x}, ${y})`);
  return el;
};

const turnValue = (): string => document.querySelector(".pos-editor__turn-value")!.textContent!;

describe("手番", () => {
  test("種の手番を出す", () => {
    render(<EditorHarness />);
    expect(turnValue()).toBe("☗先手");
  });

  test("駒落ちは上手から", () => {
    renderSeeded(stateFromPreset("2"));
    expect(turnValue()).toBe("☖後手");
  });

  test("「変更」で入れ替わる", () => {
    render(<EditorHarness />);
    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(turnValue()).toBe("☖後手");

    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(turnValue()).toBe("☗先手");
  });

  test("盤の駒は動かない", () => {
    render(<EditorHarness />);
    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(document.querySelectorAll(".pos-editor__square .piece")).toHaveLength(40);
  });

  test("掴んでいる駒を離さない", () => {
    // 手番は盤の外の値で、掴んでいる駒の行き先を変えない
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    fireEvent.click(screen.getByRole("button", { name: "変更" }));

    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(true);
  });

  test("盤の中にも駒台の中にも置かない", () => {
    // 囲われた場所に入れると、盤・駒台と並ぶ4つ目の置き場に見える。
    // **見た目は測れない**（この環境では SCSS が読まれない）ので、置き場所だけを固定する
    render(<EditorHarness />);
    const row = document.querySelector<HTMLElement>(".pos-editor__turn")!;
    expect(row.closest(".pos-editor__board")).toBeNull();
    expect(row.closest(".pos-editor__stand")).toBeNull();
  });
});
