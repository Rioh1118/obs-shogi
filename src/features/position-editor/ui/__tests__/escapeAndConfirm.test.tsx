// @vitest-environment happy-dom
import { describe, expect, test, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { FileTreeNode } from "@/entities/file-tree";
import type { StudyPosition } from "@/entities/study-positions/model/types";

/**
 * Esc の段と、組みかけを捨てる確認（状態遷移表の X10 / X13）。
 *
 * **段が1つずれると、組んだものが黙って消えるか、逆に何も組んでいないのに
 * 毎回確認が出て、確認そのものが読まれなくなる。**
 */

const createNewFile = vi.fn();
const dir = (name: string, path: string): FileTreeNode => ({
  id: path,
  name,
  path,
  isDirectory: true,
  children: [],
  displayInfo: { iconType: "folder" },
});

vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile, fileTree: dir("root", "/root") }),
}));

const { EditorHarness } = await import("./harness");

const STUDY: StudyPosition = {
  id: "sp1",
  sfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1",
  label: "3手詰",
  description: "",
  state: "inbox",
  tags: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  createNewFile.mockReset();
  createNewFile.mockResolvedValue({ success: true });
});
afterEach(cleanup);

const onCancel = vi.fn();

const square = (x: number, y: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `.pos-editor__square[data-x="${x}"][data-y="${y}"]`,
  );
  if (!el) throw new Error(`升が無い: (${x}, ${y})`);
  return el;
};

const editor = (): HTMLElement => document.querySelector<HTMLElement>(".pos-editor")!;
const confirm = (): HTMLElement | null => document.querySelector(".confirm-dialog");
const onBoardFace = (): boolean => document.querySelector(".pos-editor__board") !== null;

/** Esc を押して、面が畳んだか（＝器へ届かせなかったか）を返す */
const pressEscape = (): boolean => {
  const dispatched = fireEvent.keyDown(editor(), { key: "Escape" });
  // `fireEvent` は `preventDefault()` されると false を返す
  return !dispatched;
};

const makeDirty = () => {
  fireEvent.click(square(7, 7));
  fireEvent.click(square(7, 6));
};

describe("Esc の段", () => {
  test("段2: 掴んでいる駒を離す。器へは届かせない", () => {
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));

    expect(pressEscape()).toBe(true);
    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(false);
  });

  test("段2 は組みかけより先。離すだけで確認は出ない", () => {
    render(<EditorHarness />);
    makeDirty();
    fireEvent.click(square(2, 7));

    pressEscape();
    expect(confirm()).toBeNull();
  });

  test("段3: 課題局面の面から盤の面へ戻る", () => {
    render(<EditorHarness studyPositions={[STUDY]} />);
    fireEvent.click(screen.getByRole("button", { name: "課題局面から" }));
    expect(onBoardFace()).toBe(false);

    expect(pressEscape()).toBe(true);
    expect(onBoardFace()).toBe(true);
  });

  test("段4: 組みかけなら確認が出る", () => {
    render(<EditorHarness />);
    makeDirty();

    expect(pressEscape()).toBe(true);
    expect(screen.getByText("組んだ局面は保存されません。")).toBeTruthy();
  });

  test("段5: 組みかけでなければ器へ届かせる", () => {
    // 畳むものが無いときは何もしない。`Modal` が閉じる
    render(<EditorHarness />);
    expect(pressEscape()).toBe(false);
    expect(confirm()).toBeNull();
  });

  test("段0: 作成中は無視する", async () => {
    let settle: (v: unknown) => void = () => undefined;
    createNewFile.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<EditorHarness />);
    makeDirty();
    fireEvent.change(screen.getByLabelText("ファイル名"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "作成" }));

    // 組みかけなのに確認を出さない。止められないものを聞いても仕方がない
    expect(pressEscape()).toBe(true);
    expect(confirm()).toBeNull();

    await act(async () => {
      settle({ success: true });
    });
  });

  test("変換中の Escape では畳まない", () => {
    // 変換中の Escape は「変換を取り消す」であって、面を畳む合図ではない
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));

    fireEvent.keyDown(editor(), { key: "Escape", isComposing: true });
    expect(square(7, 7).classList.contains("pos-editor__square--from")).toBe(true);
  });
});

describe("捨てる確認", () => {
  test("組みかけでなければ出さない", () => {
    // 聞きすぎると、聞かれること自体が意味を失う
    render(<EditorHarness />);
    fireEvent.click(document.querySelector<HTMLElement>("#pos-editor-handicap")!);
    fireEvent.click(screen.getByRole("option", { name: "二枚落ち" }));

    expect(confirm()).toBeNull();
    expect(document.querySelectorAll(".pos-editor__square .piece")).toHaveLength(38);
  });

  test("「組み続ける」で組みかけが残る", () => {
    render(<EditorHarness />);
    makeDirty();
    pressEscape();

    fireEvent.click(screen.getByRole("button", { name: "組み続ける" }));
    expect(confirm()).toBeNull();
    expect(square(7, 7).querySelector(".piece")).toBeNull(); // 動かしたまま
  });

  test("「捨てる」で保留した操作が走る", () => {
    render(<EditorHarness onCancel={onCancel} />);
    makeDirty();
    pressEscape();

    fireEvent.click(screen.getByRole("button", { name: "捨てる" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("種を選び直すときも同じ確認を通る", () => {
    render(<EditorHarness studyPositions={[STUDY]} />);
    makeDirty();
    fireEvent.click(screen.getByRole("button", { name: "課題局面から" }));
    fireEvent.click(document.querySelector<HTMLElement>(".pos-editor__picker-row")!);

    expect(screen.getByText("組んだ局面は保存されません。")).toBeTruthy();
    // 押した瞬間には載らない
    expect(onBoardFace()).toBe(false);
  });

  test("課題局面を「捨てる」で載せると盤へ戻る", () => {
    render(<EditorHarness studyPositions={[STUDY]} />);
    makeDirty();
    fireEvent.click(screen.getByRole("button", { name: "課題局面から" }));
    fireEvent.click(document.querySelector<HTMLElement>(".pos-editor__picker-row")!);
    fireEvent.click(screen.getByRole("button", { name: "捨てる" }));

    expect(onBoardFace()).toBe(true);
    expect(document.querySelectorAll(".pos-editor__square .piece")).toHaveLength(2);
  });

  test("実行する側は「捨てる」。用途を決めつけない文言にする", () => {
    render(<EditorHarness />);
    makeDirty();
    pressEscape();

    expect(screen.getByRole("button", { name: "捨てる" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "削除する" })).toBeNull();
    // 戻る側は、器ごと閉じるフォームの「やめる」と別の語にする
    expect(screen.getByRole("button", { name: "組み続ける" })).toBeTruthy();
  });
});
