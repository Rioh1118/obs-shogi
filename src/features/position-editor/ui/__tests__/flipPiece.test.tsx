// @vitest-environment happy-dom
import { describe, expect, test, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Color } from "shogi.js";
import { emptyHand } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { EditorHarness } from "./harness";

/**
 * 右クリックで裏返す（状態遷移表の X3）。
 *
 * 巡回そのものは `cycleFrom` / `cycleOnBoard` のテストが固定している。
 * ここが見るのは**升ごとの覚えが画面で正しく引き継がれるか** ——
 * 引き継ぎを間違えると「押しても何も変わらない」か「持ち主が飛ぶ」になる。
 */

afterEach(cleanup);

/** 種を載せてから確かめる。**種を載せる経路そのものを通す**（prop で差し込まない） */
function renderSeeded(state: JKFState) {
  render(<EditorHarness currentPosition={state} />);
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

/** 駒の絵から種類と先後を読む。`PieceFactory` が付ける印を通す */
const pieceAt = (x: number, y: number): string | null => {
  const el = square(x, y).querySelector<HTMLElement>(".piece");
  if (!el) return null;
  const kind = [...el.classList].find((c) => c.startsWith("piece__"));
  const side = el.classList.contains("sente") ? "sente" : "gote";
  return `${kind}/${side}`;
};

describe("右クリックで裏返す", () => {
  test("不成 → 成 → 相手の成 → 相手の不成 で1周する", () => {
    const state = emptyState();
    state.board[4][4] = { kind: "FU", color: Color.Black };
    renderSeeded(state);

    const start = pieceAt(5, 5);
    expect(start).toBe("piece__pawn/sente");

    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBe("piece__prom-pawn/sente");

    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBe("piece__prom-pawn/gote");

    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBe("piece__pawn/gote");

    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBe(start);
  });

  test("玉と金は2巡で戻る", () => {
    const state = emptyState();
    state.board[4][4] = { kind: "KI", color: Color.Black };
    renderSeeded(state);

    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBe("piece__gold/gote");
    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBe("piece__gold/sente");
  });

  test("駒のない升では何も起きない", () => {
    renderSeeded(emptyState());
    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBeNull();
  });

  test("既定のメニューを止める", () => {
    // 器の中に OS のメニューが開くと、その裏で局面が変わったのか分からなくなる
    render(<EditorHarness />);
    const stopped = fireEvent.contextMenu(square(7, 7));
    expect(stopped).toBe(false);
  });

  test("掴んでいる駒は離す", () => {
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(true);

    fireEvent.contextMenu(square(2, 7));
    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(false);
    expect(document.querySelector(".pos-editor__ghost")).toBeNull();
  });

  test("升ごとに別の巡目を覚える", () => {
    const state = emptyState();
    state.board[4][4] = { kind: "FU", color: Color.Black };
    state.board[3][4] = { kind: "FU", color: Color.Black };
    renderSeeded(state);

    fireEvent.contextMenu(square(5, 5));
    fireEvent.contextMenu(square(5, 5)); // 5五 は2巡目
    fireEvent.contextMenu(square(4, 5)); // 4五 は1巡目

    expect(pieceAt(5, 5)).toBe("piece__prom-pawn/gote");
    expect(pieceAt(4, 5)).toBe("piece__prom-pawn/sente");
  });

  test("駒が入れ替わった升では、覚えていた巡目を引き継がない", () => {
    // 巡目だけを覚えていると、ここで `{FU, 先手}` が返って**同じ駒がそのまま返る**
    const state = emptyState();
    state.board[4][4] = { kind: "FU", color: Color.Black };
    state.board[3][4] = { kind: "FU", color: Color.Black };
    renderSeeded(state);

    fireEvent.contextMenu(square(5, 5));
    fireEvent.contextMenu(square(5, 5)); // 5五 は後手と金（巡目2）
    expect(pieceAt(5, 5)).toBe("piece__prom-pawn/gote");

    // 4五 の先手歩を 5五 へ重ねる。5五 は先手歩になる
    fireEvent.click(square(4, 5));
    fireEvent.click(square(5, 5));
    expect(pieceAt(5, 5)).toBe("piece__pawn/sente");

    fireEvent.contextMenu(square(5, 5));
    expect(pieceAt(5, 5)).toBe("piece__prom-pawn/sente");
  });
});
