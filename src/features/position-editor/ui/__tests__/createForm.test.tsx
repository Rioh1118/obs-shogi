// @vitest-environment happy-dom
import { describe, expect, test, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { Color } from "shogi.js";
import type { FileTreeNode, FsError } from "@/entities/file-tree";

/**
 * 組んだ局面から棋譜を作る（状態遷移表の X11 / X12a〜c）。
 *
 * **見どころは出口に何を書くか。** 手合割のままなら手合割として、
 * 並べ替えたなら盤ごと書く。取り違えると、並べ替えが黙って落ちるか、
 * 平手の棋譜から手合割が消える。
 */

const createNewFile = vi.fn();

/** 保存先の一覧に要る欄だけを持つツリー。描画に要る `displayInfo` は使わない */
const dir = (name: string, path: string, children: FileTreeNode[] = []): FileTreeNode =>
  ({
    name,
    path,
    isDirectory: true,
    children,
    displayInfo: { iconType: "folder" },
  }) as FileTreeNode;

const TREE = dir("root", "/root", [dir("角換わり", "/root/角換わり")]);

vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({ createNewFile, fileTree: TREE }),
}));

const { EditorHarness } = await import("./harness");

const CONFLICT: FsError = {
  code: "already_exists",
  message: "destination already exists",
  path: "/root/a.kif",
};
const DENIED: FsError = {
  code: "permission_denied",
  message: "permission denied",
  path: "/root",
};

beforeEach(() => {
  createNewFile.mockReset();
  createNewFile.mockResolvedValue({ success: true });
});
afterEach(cleanup);

const square = (x: number, y: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `.pos-editor__square[data-x="${x}"][data-y="${y}"]`,
  );
  if (!el) throw new Error(`升が無い: (${x}, ${y})`);
  return el;
};

const nameInput = () => screen.getByLabelText("ファイル名");
const createButton = () => screen.getByRole("button", { name: "作成" });

const submit = async (name = "45角戦法") => {
  fireEvent.change(nameInput(), { target: { value: name } });
  await act(async () => {
    fireEvent.click(createButton());
  });
};

describe("出口に書く初期局面", () => {
  test("手合割のままなら手合割として書く", async () => {
    // 常に `OTHER` にすると、平手をそのまま作っただけの棋譜から手合割が消える
    render(<EditorHarness />);
    await submit();

    expect(createNewFile).toHaveBeenCalledTimes(1);
    expect(createNewFile.mock.calls[0]![1].initialPosition).toEqual({ preset: "HIRATE" });
  });

  test("並べ替えたら盤ごと書く", async () => {
    // 常に手合割として書くと、並べ替えが黙って落ちる
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    fireEvent.click(square(7, 6));
    await submit();

    const initial = createNewFile.mock.calls[0]![1].initialPosition;
    expect(initial.preset).toBe("OTHER");
    expect(initial.data.board[6][6]).toEqual({});
  });

  test("手番だけ変えても盤ごと書く", async () => {
    render(<EditorHarness />);
    fireEvent.click(screen.getByRole("button", { name: "変更" }));
    await submit();

    const initial = createNewFile.mock.calls[0]![1].initialPosition;
    expect(initial.preset).toBe("OTHER");
    expect(initial.data.color).toBe(Color.White);
  });

  test("別の手合割を選び直したら、その手合割として書く", async () => {
    render(<EditorHarness />);
    fireEvent.click(document.querySelector<HTMLElement>("#pos-editor-handicap")!);
    fireEvent.click(screen.getByRole("option", { name: "二枚落ち" }));
    await submit();

    expect(createNewFile.mock.calls[0]![1].initialPosition).toEqual({ preset: "2" });
  });
});

describe("ファイルの欄", () => {
  test("名前が空なら押せない", () => {
    render(<EditorHarness />);
    expect(createButton()).toHaveProperty("disabled", true);
  });

  test("拡張子は形式が決める", async () => {
    render(<EditorHarness />);
    fireEvent.click(document.querySelector<HTMLElement>("#pos-editor-format")!);
    fireEvent.click(screen.getByRole("option", { name: "csa" }));
    await submit();

    expect(createNewFile.mock.calls[0]![1].fileName).toBe("45角戦法.csa");
  });

  test("保存先を選べる", async () => {
    // ようこそ画面から開くと `dir=` が来ない。欄が無いと黙って root へ作る
    render(<EditorHarness />);
    fireEvent.click(document.querySelector<HTMLElement>("#pos-editor-dir")!);
    fireEvent.click(screen.getByRole("option", { name: "/角換わり" }));
    await submit();

    expect(createNewFile.mock.calls[0]![0]).toBe("/root/角換わり");
  });

  test("タグとメモも渡る", async () => {
    render(<EditorHarness />);
    fireEvent.change(screen.getByLabelText("メモ"), { target: { value: "先手良し" } });
    await submit();

    expect(createNewFile.mock.calls[0]![1].gameInfo.note).toBe("先手良し");
  });
});

describe("断りが出ていても", () => {
  test("「作成」は押せるまま", async () => {
    // 押せなくすると詰将棋が作れない
    render(<EditorHarness />);
    fireEvent.change(nameInput(), { target: { value: "45角戦法" } });
    fireEvent.click(square(8, 7));
    fireEvent.click(square(7, 6)); // 7筋に先手の歩が2枚になる

    expect(document.querySelector(".notice--danger")).not.toBeNull();
    expect(createButton()).toHaveProperty("disabled", false);

    await submit();
    expect(createNewFile).toHaveBeenCalledTimes(1);
  });
});

describe("失敗の見せ方", () => {
  test("衝突はこのフォームに出さない", async () => {
    // 別名を選ぶ対話が引き取る。ここで描くと対話の背後に二重に出る
    createNewFile.mockResolvedValue({ success: false, error: CONFLICT });
    render(<EditorHarness />);
    await submit();

    expect(document.querySelector(".fsError")).toBeNull();
  });

  test("それ以外はフォームの中に出す", async () => {
    createNewFile.mockResolvedValue({ success: false, error: DENIED });
    render(<EditorHarness />);
    await submit();

    expect(document.querySelector(".fsError")).not.toBeNull();
  });

  test("失敗しても入力欄が残る", async () => {
    // 差し替えると入力欄が消え、キーボードの利用者は自分がどこにいるか分からなくなる
    createNewFile.mockResolvedValue({ success: false, error: DENIED });
    render(<EditorHarness />);
    await submit();

    expect(nameInput()).toHaveProperty("value", "45角戦法");
  });

  test("失敗しても盤が残る", async () => {
    createNewFile.mockResolvedValue({ success: false, error: DENIED });
    render(<EditorHarness />);
    fireEvent.click(square(7, 7));
    fireEvent.click(square(7, 6));
    await submit();

    expect(square(7, 6).querySelector(".piece")).not.toBeNull();
  });

  test("二度押しても2本作らない", async () => {
    let settle: (v: unknown) => void = () => undefined;
    createNewFile.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<EditorHarness />);

    fireEvent.change(nameInput(), { target: { value: "45角戦法" } });
    // 1度目の後は「作成中...」に変わるので、要素を先に掴んでおく
    const button = createButton();
    fireEvent.click(button);
    fireEvent.click(button);

    await act(async () => {
      settle({ success: true });
    });
    expect(createNewFile).toHaveBeenCalledTimes(1);
  });
});
