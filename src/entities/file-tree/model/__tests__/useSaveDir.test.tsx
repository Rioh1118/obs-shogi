// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FileTreeNode } from "../types";

/**
 * 棋譜を作る3つの面（組む面、インポートの面、課題局面から作る対話）が共有する保存先の欄。
 *
 * ツリーは操作のたびに丸ごと読み直され、起動の直後はまだ無い。欄の値がどのツリーに
 * 対して選ばれたものかを、ツリーが替わるたびに決め直す。
 */

let fileTree: FileTreeNode | null = null;

vi.mock("../useFileTree", () => {
  const mocked = {
    useFileTree: () =>
      ({ fileTree }) as unknown as ReturnType<typeof import("../useFileTree").useFileTree>,
  };
  return mocked satisfies typeof import("../useFileTree");
});

const { useSaveDir } = await import("../useSaveDir");

const dir = (name: string, path: string, children: FileTreeNode[] = []): FileTreeNode =>
  ({ name, path, isDirectory: true, children }) as FileTreeNode;

const TREE = dir("root", "/root", [dir("角換わり", "/root/角換わり")]);

beforeEach(() => {
  fileTree = TREE;
});
afterEach(cleanup);

describe("useSaveDir", () => {
  test("フォルダが来なければ、ツリーの根を選ぶ", () => {
    const { result } = renderHook(() => useSaveDir());

    expect(result.current.selectedDir).toBe("/root");
    expect(result.current.dirOptions.map((o) => o.label)).toEqual(["/", "/角換わり"]);
  });

  test("ツリーから開いたら、そのフォルダを選ぶ", () => {
    const { result } = renderHook(() => useSaveDir("/root/角換わり"));

    expect(result.current.selectedDir).toBe("/root/角換わり");
  });

  test("ツリーが無ければ、一覧は空で何も選ばない", () => {
    fileTree = null;
    const { result } = renderHook(() => useSaveDir());

    expect(result.current.dirOptions).toEqual([]);
    expect(result.current.selectedDir).toBe("");
  });

  /**
   * 状態遷移表の ※14「開いたときの `dir=` が現在のツリーに無い場合」。
   * 値だけ残すと、欄が「選択してください」と言っているのに無いパスへ書きに行く。
   */
  test("来たフォルダがツリーに無ければ、根を選ぶ", () => {
    const { result } = renderHook(() => useSaveDir("/root/消えた"));

    expect(result.current.selectedDir).toBe("/root");
  });

  test("ツリーの根が替わったら、新しい根を選ぶ", () => {
    const { result, rerender } = renderHook(() => useSaveDir("/root/角換わり"));

    fileTree = dir("other", "/other", [dir("角換わり", "/other/角換わり")]);
    rerender();

    expect(result.current.selectedDir).toBe("/other");
  });

  test("選んでいたフォルダが消えたら、根へ戻す", () => {
    const { result, rerender } = renderHook(() => useSaveDir());
    act(() => result.current.setSelectedDir("/root/角換わり"));

    fileTree = dir("root", "/root");
    rerender();

    expect(result.current.selectedDir).toBe("/root");
  });

  /**
   * ツリーを読み終わる前に URL の `dir=` から開くと、根が `""` から替わる描画が来る。
   * そこで根へ戻すと、ツリーから来たフォルダが黙って根に替わり、根へ書く。
   */
  describe("ツリーを読み終わる前に開いたとき", () => {
    beforeEach(() => {
      fileTree = null;
    });

    test("読み終わったら、来たフォルダを選ぶ", () => {
      const { result, rerender } = renderHook(() => useSaveDir("/root/角換わり"));

      fileTree = TREE;
      rerender();

      expect(result.current.selectedDir).toBe("/root/角換わり");
    });

    test("来たフォルダが読み終わったツリーに無ければ、根を選ぶ", () => {
      const { result, rerender } = renderHook(() => useSaveDir("/root/消えた"));

      fileTree = TREE;
      rerender();

      expect(result.current.selectedDir).toBe("/root");
    });

    test("フォルダが来ていなければ、読み終わった根を選ぶ", () => {
      const { result, rerender } = renderHook(() => useSaveDir());

      fileTree = TREE;
      rerender();

      expect(result.current.selectedDir).toBe("/root");
    });
  });
});
