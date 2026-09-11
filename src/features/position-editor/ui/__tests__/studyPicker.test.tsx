// @vitest-environment happy-dom
import { describe, expect, test, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import { EditorHarness } from "./harness";

/**
 * 課題局面から種を選ぶ（状態遷移表の X6 / X8）。
 *
 * **確定ボタンは無い。行を押した瞬間に載って盤の面へ戻る。**
 */

// 組む面はファイルを作る口（`useFileTree`）を持つ。ここで見たいのは盤の側なので、
// 保存先が無い状態に固定する（作成そのものは `createForm.test.tsx` が見る）
vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile: vi.fn(), fileTree: null }),
}));

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
// **見えているかで判定する。** 課題局面の面へ移っても盤とフォームは木に残る
// （外すと打った入力が消える）ので、有無では面を判定できない
const onBoardFace = (): boolean =>
  document.querySelector(".pos-editor__main:not([hidden]) .pos-editor__board") !== null;

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

  test("読めない SFEN の行は、押す前に沈む", () => {
    // **押しても何も起きない行を作らない**（不変条件2）。
    // `study_positions.json` は Rust 側に SFEN の検査が無いので、読めない綴りが入りうる
    openPicker([position({ sfen: "これは SFEN ではない" })]);
    expect(rows()[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(rows()[0]!.classList.contains("is-broken")).toBe(true);
    expect(screen.getByText("読めません")).toBeTruthy();
  });

  test("読めない行を下見しても、盤の絵を待たせ続けない", () => {
    openPicker([position({ sfen: "これは SFEN ではない" })]);
    expect(screen.queryByText("局面を読み込み中...")).toBeNull();
    expect(
      screen.getByText(
        "この課題局面は盤に載せられません。保存されている局面の綴りが壊れています。",
      ),
    ).toBeTruthy();
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

  test("面に入った時点で ↑↓ が効く", () => {
    // 焦点を移さないと、押した「課題局面から」が消えたあと `Modal` が焦点を
    // タブへ引き戻し、一覧の受け口が合成イベントの経路から外れる。
    // **焦点のある場所から撃つ** —— 受け口へ直に撃つと、この形は見えない
    openPicker([position(), position({ id: "sp2", label: "四間飛車" })]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
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

  test("↑↓ で選んで Enter で載る", () => {
    // **鍵盤で始めたら鍵盤で終われること。** 下見だけできて決める口が無いと、
    // 鍵盤だけの利用者は種を1つも選べない
    openPicker([position({ sfen: HIRATE }), position({ id: "sp2", sfen: TSUME })]);
    const face = document.activeElement!;
    fireEvent.keyDown(face, { key: "ArrowDown" });
    fireEvent.keyDown(face, { key: "Enter" });

    expect(onBoardFace()).toBe(true);
    expect(boardPieces()).toBe(1);
  });

  test("読めない行では Enter も効かない", () => {
    openPicker([position({ sfen: "これは SFEN ではない" })]);
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onBoardFace()).toBe(false);
  });

  test("検索欄の ↑↓ は下見を動かさない", () => {
    // キャレット移動と IME の候補操作を奪わない
    openPicker([position(), position({ id: "sp2", label: "四間飛車" })]);
    fireEvent.keyDown(screen.getByLabelText("課題局面を検索"), { key: "ArrowDown" });
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

  test("絞り込んでも、下見は同じ行に留まる", () => {
    // **下見は行そのもので覚える。** 位置で覚えると、絞り込みで行が繰り上がったときに
    // 押してもいない別の局面へ黙って移る
    openPicker([
      position({ id: "a", label: "序盤" }),
      position({ id: "b", label: "中盤の研究" }),
      position({ id: "c", label: "終盤の研究" }),
    ]);
    fireEvent.mouseEnter(rows()[2]!);

    // 先頭が落ちて3件→2件。位置で覚えていると、2番目を指したまま一覧の外に出る
    fireEvent.change(screen.getByLabelText("課題局面を検索"), { target: { value: "研究" } });
    expect(rows()).toHaveLength(2);
    expect(rows()[1]!.getAttribute("aria-selected")).toBe("true");
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
