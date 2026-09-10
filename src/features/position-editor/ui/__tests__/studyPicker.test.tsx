// @vitest-environment happy-dom
import { describe, expect, test, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import { EditorHarness } from "./harness";

/**
 * 課題局面から種を選ぶ（状態遷移表の X6 / X8）。
 *
 * **確定ボタンは無い。行を押した瞬間に載って盤の面へ戻る。**
 */

afterEach(cleanup);

const TSUME = "4k4/9/9/9/9/9/9/9/9 b G 1";
const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

function position(over: Partial<StudyPosition> = {}): StudyPosition {
  return {
    id: "sp1",
    sfen: HIRATE,
    label: "角換わり",
    description: "",
    state: "active",
    tags: ["角換わり"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const openPicker = (positions: StudyPosition[]) => {
  render(<EditorHarness studyPositions={positions} />);
  fireEvent.click(screen.getByRole("button", { name: "課題局面から" }));
};

const rows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(".pos-editor__picker-row"),
];
const boardPieces = (): number => document.querySelectorAll(".pos-editor__square .piece").length;
const onBoardFace = (): boolean => document.querySelector(".pos-editor__board") !== null;

describe("面の出入り", () => {
  test("「課題局面から」で一覧に入る", () => {
    openPicker([position()]);
    expect(onBoardFace()).toBe(false);
    expect(rows()).toHaveLength(1);
  });

  test("**押した時点では種が載らない。** 面が変わるだけ", () => {
    // 載せるのを行の押下に寄せないと、捨てた直後の盤に何が残るか決まらない
    openPicker([position()]);
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(boardPieces()).toBe(40); // 平手のまま
  });

  test("「戻る」で盤の面へ帰る", () => {
    openPicker([position()]);
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(onBoardFace()).toBe(true);
  });
});

describe("行を押す", () => {
  test("押した瞬間に載って盤の面へ戻る", () => {
    openPicker([position({ sfen: TSUME })]);
    fireEvent.click(rows()[0]!);

    expect(onBoardFace()).toBe(true);
    expect(boardPieces()).toBe(1);
  });

  test("確定ボタンは無い", () => {
    openPicker([position()]);
    expect(screen.queryByRole("button", { name: "この局面にする" })).toBeNull();
    expect(screen.queryByRole("button", { name: "決定" })).toBeNull();
  });

  test("読めない SFEN の行は盤へ戻さない", () => {
    // 黙って盤へ戻すと、種が変わっていないのに別の局面が載ったように見える。
    // 面に留めれば、その行が選べないことが画面から読める
    openPicker([position({ sfen: "これは SFEN ではない" })]);
    fireEvent.click(rows()[0]!);
    expect(onBoardFace()).toBe(false);
  });

  test("持ち駒も一緒に載る", () => {
    openPicker([position({ sfen: TSUME })]);
    fireEvent.click(rows()[0]!);
    expect(document.querySelectorAll(".pos-editor__stack-piece")).toHaveLength(1);
  });
});

describe("下見", () => {
  test("最初の行のプレビューが出ている", () => {
    openPicker([position({ sfen: TSUME }), position({ id: "sp2", sfen: HIRATE })]);
    expect(rows()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  test("ホバーで下見が移る", () => {
    openPicker([position(), position({ id: "sp2", label: "四間飛車" })]);
    fireEvent.mouseEnter(rows()[1]!);
    expect(rows()[1]!.getAttribute("aria-selected")).toBe("true");
  });

  test("↑↓ で下見が移る", () => {
    openPicker([position(), position({ id: "sp2", label: "四間飛車" })]);
    const face = document.querySelector<HTMLElement>(".pos-editor__picker")!;

    fireEvent.keyDown(face, { key: "ArrowDown" });
    expect(rows()[1]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(face, { key: "ArrowUp" });
    expect(rows()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  test("↑↓ は一覧の端で止まる", () => {
    openPicker([position()]);
    const face = document.querySelector<HTMLElement>(".pos-editor__picker")!;
    fireEvent.keyDown(face, { key: "ArrowUp" });
    fireEvent.keyDown(face, { key: "ArrowDown" });
    expect(rows()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  test("下見しただけでは載らない", () => {
    openPicker([position({ sfen: TSUME })]);
    fireEvent.mouseEnter(rows()[0]!);
    expect(onBoardFace()).toBe(false);
  });
});

describe("絞り込み", () => {
  const many = [
    position({ id: "a", label: "角換わり", state: "active", tags: ["角換わり"] }),
    position({ id: "b", label: "四間飛車", state: "inbox", tags: ["振り飛車"] }),
    position({ id: "c", label: "", description: "3手詰", state: "done", tags: [] }),
  ];

  test("ラベルで絞る", () => {
    openPicker(many);
    fireEvent.change(screen.getByLabelText("課題局面を検索"), { target: { value: "四間" } });
    expect(rows()).toHaveLength(1);
  });

  test("メモでも絞る", () => {
    openPicker(many);
    fireEvent.change(screen.getByLabelText("課題局面を検索"), { target: { value: "3手詰" } });
    expect(rows()).toHaveLength(1);
  });

  test("タグでも絞る", () => {
    openPicker(many);
    fireEvent.change(screen.getByLabelText("課題局面を検索"), { target: { value: "振り飛車" } });
    expect(rows()).toHaveLength(1);
  });

  test("状態で絞る", () => {
    openPicker(many);
    fireEvent.click(document.querySelector<HTMLElement>("#pos-editor-study-state")!);
    fireEvent.click(screen.getByRole("option", { name: "未整理" }));
    expect(rows()).toHaveLength(1);
  });

  test("絞って行が減っても、下見が一覧の外に残らない", () => {
    // 外に出たまま ↑↓ を押すと、何も無い場所を指したままプレビューが空になる
    openPicker(many);
    const face = document.querySelector<HTMLElement>(".pos-editor__picker")!;
    fireEvent.keyDown(face, { key: "ArrowDown" });
    fireEvent.keyDown(face, { key: "ArrowDown" });

    fireEvent.change(screen.getByLabelText("課題局面を検索"), { target: { value: "四間" } });
    expect(rows()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  test("条件に合わなければ、そう書く", () => {
    openPicker(many);
    fireEvent.change(screen.getByLabelText("課題局面を検索"), { target: { value: "存在しない" } });
    expect(screen.getByText("この条件に合う課題局面はありません。")).toBeTruthy();
  });

  test("1件も無ければ別の文で言う", () => {
    // ここから登録する導線が無いので「登録してください」と書かない
    openPicker([]);
    expect(screen.getByText("課題局面がまだありません。")).toBeTruthy();
  });
});
