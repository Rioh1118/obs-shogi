import { describe, expect, test } from "vitest";
import { reducer } from "../reducer";
import { initialState, type FileTreeNode, type FileTreeState } from "../types";
import { makeFsError } from "@/entities/file-tree/api/error";

/**
 * 状態遷移表は `docs/state-transitions/file-tree.md`。
 *
 * 失敗はツリーの取得とファイル操作の両方が同じ `error` に積まれる。
 * 積んだときに編集中の行をどうするかは表示側からは見えないので、ここで固定する。
 */

const ERROR = makeFsError("invalid_name", "名前にパス区切りを含めることはできません", "/root/a");

const ROOT: FileTreeNode = {
  id: "root",
  name: "root",
  path: "/root",
  isDirectory: true,
  children: [],
  displayInfo: { iconType: "folder" },
};

const CHILD: FileTreeNode = {
  id: "node-1",
  name: "a.kif",
  path: "/root/a.kif",
  isDirectory: false,
  displayInfo: { iconType: "kif-file" },
};

/** 編集中・メニューを開いている最中の状態。 */
function editing(): FileTreeState {
  return {
    ...initialState,
    fileTree: ROOT,
    renamingNodeId: CHILD.id,
    creatingDirParentPath: ROOT.path,
    menu: { node: CHILD, x: 0, y: 0 },
  };
}

describe("失敗を積んだとき", () => {
  // 開いたままにすると、失敗を伝える表示がその上に重なる。閉じる操作で入力が
  // blur すると同じ名前がもう一度送られ、また失敗する。閉じても戻ってくる
  test("編集中の行を畳む", () => {
    const next = reducer(editing(), { type: "error", payload: ERROR });

    expect(next.renamingNodeId).toBeNull();
    expect(next.creatingDirParentPath).toBeNull();
  });

  test("失敗の中身はそのまま持つ", () => {
    const next = reducer(editing(), { type: "error", payload: ERROR });

    expect(next.error).toEqual(ERROR);
  });

  test("コンテキストメニューを閉じる", () => {
    const next = reducer(editing(), { type: "error", payload: ERROR });

    expect(next.menu).toBeNull();
  });

  test("ツリーは捨てない", () => {
    const next = reducer(editing(), { type: "error", payload: ERROR });

    expect(next.fileTree).not.toBeNull();
  });

  test("読み込み中の表示は下ろす", () => {
    const loading = { ...editing(), isLoading: true };
    const next = reducer(loading, { type: "error", payload: ERROR });

    expect(next.isLoading).toBe(false);
  });

  // `conflict_opened` は同じ失敗経路の隣にいる。こちらは畳む側の先例
  test("同名の衝突でも同じように畳む", () => {
    const next = reducer(editing(), {
      type: "conflict_opened",
      payload: {
        request: { kind: "rename_file", path: CHILD.path, newName: "b.kif" },
        error: ERROR,
      },
    });

    expect(next.renamingNodeId).toBeNull();
    expect(next.creatingDirParentPath).toBeNull();
    expect(next.menu).toBeNull();
  });
});

describe("衝突の解決中に失敗したとき", () => {
  function resolving(): FileTreeState {
    return reducer(editing(), {
      type: "conflict_opened",
      payload: {
        request: { kind: "rename_file", path: CHILD.path, newName: "b.kif" },
        error: makeFsError("already_exists", "同じ名前のものがあります"),
      },
    });
  }

  // 積むとモーダルが2枚重なり、Escape は下のダイアログだけを閉じる
  test("ダイアログの上に別の失敗を重ねない", () => {
    const next = reducer(resolving(), { type: "error", payload: ERROR });

    expect(next.error).toBeNull();
    expect(next.conflict).not.toBeNull();
  });

  test("読み込み中の表示は下ろす", () => {
    const next = reducer({ ...resolving(), isLoading: true }, { type: "error", payload: ERROR });

    expect(next.isLoading).toBe(false);
  });
});

describe("読み直しを始めたとき", () => {
  // 表示側はこれを前提に、読み直しの引き金になった失敗を自分で持つ
  test("失敗を消す", () => {
    const errored = reducer(editing(), { type: "error", payload: ERROR });
    const next = reducer(errored, { type: "loading" });

    expect(next.error).toBeNull();
    expect(next.isLoading).toBe(true);
  });

  test("読み込めたら失敗は消えている", () => {
    const errored = reducer(editing(), { type: "error", payload: ERROR });
    const next = reducer(errored, { type: "tree_loaded", payload: ROOT });

    expect(next.error).toBeNull();
    expect(next.isLoading).toBe(false);
  });
});
