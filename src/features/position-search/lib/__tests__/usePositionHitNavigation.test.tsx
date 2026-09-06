// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import type { CursorLite } from "@/entities/search";

/**
 * 索引に在る棋譜がツリーに無いのは正常運転で起こる（`scan_kifu_files` が失敗した回は
 * 削除が当たらない）。**そのとき移動は始まっていない**ので、
 * 呼び手がそれを知れなければ「開いた」ように見えるだけの操作になる。
 */

const selectNodeByAbsPath = vi.fn();
const applyCursor = vi.fn();

type SelectedNode = { path: string; isDirectory: boolean } | null;
const stub = {
  selectedNode: null as SelectedNode,
  player: null as unknown,
  isLoading: false,
  loadedAbsPath: null as string | null,
  kifuError: null as { path?: string } | null,
};

vi.mock("@/entities/file-tree", () => ({
  useFileTree: () => ({
    selectedNode: stub.selectedNode,
    selectNodeByAbsPath,
    kifuError: stub.kifuError,
  }),
}));

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: { isLoading: stub.isLoading, loadedAbsPath: stub.loadedAbsPath },
    view: { player: stub.player },
    applyCursor,
  }),
}));

const { usePositionHitNavigation } = await import("../usePositionHitNavigation");

const CURSOR: CursorLite = { tesuu: 3, forkPointers: [] };

beforeEach(() => {
  stub.selectedNode = null;
  stub.player = null;
  stub.isLoading = false;
  stub.loadedAbsPath = null;
  stub.kifuError = null;
  selectNodeByAbsPath.mockReset();
  applyCursor.mockReset();
});

afterEach(() => cleanup());

describe("usePositionHitNavigation", () => {
  test("ツリーにその棋譜が無ければ false。局面も動かさない", () => {
    selectNodeByAbsPath.mockReturnValue(false);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/gone.kif", CURSOR)).toBe(false);
    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("ツリーを切り替えられたら true（局面はファイルが読めてから当たる）", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/b.kif", CURSOR)).toBe(true);
    expect(selectNodeByAbsPath).toHaveBeenCalledWith("/root/b.kif");
  });

  test("同じ棋譜が盤に載っていれば、その場で局面へ当てて true", () => {
    stub.selectedNode = { path: "/root/a.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/a.kif";
    stub.player = {};

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/a.kif", CURSOR)).toBe(true);
    expect(selectNodeByAbsPath).not.toHaveBeenCalled();
    expect(applyCursor).toHaveBeenCalledTimes(1);
  });

  /**
   * 選択は即座に切り替わるのに、`view.player` は**盤に載っている棋譜**の再生器。
   * 選択だけを見て当てると、前の棋譜に別の棋譜のカーソルが当たる。
   */
  test("選んであっても盤にまだ載っていなければ、その場では当てない", () => {
    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/a.kif";
    stub.player = {};
    selectNodeByAbsPath.mockReturnValue(true);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.startNavigationToHit("/root/b.kif", CURSOR)).toBe(true);
    expect(applyCursor).not.toHaveBeenCalled();
  });

  /** 要求を出したあと、その棋譜が盤に載ったら当てる（この経路が生きていること） */
  test("要求した棋譜が読み終わったら当たる", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).toHaveBeenCalledTimes(1);
  });

  /**
   * 要求は1回きり。捨てないと、開けなかった棋譜の要求がアプリを終えるまで残り、
   * あとでその棋譜を普通に開いた瞬間に頼んでいない局面へ盤が動く。
   */
  test("別の棋譜を選んだら要求は流れ、あとでその棋譜が読めても当たらない", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    stub.selectedNode = { path: "/root/c.kif", isDirectory: false };
    rerender();

    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("その棋譜を読めなかったら要求は流れる", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result, rerender } = renderHook(() => usePositionHitNavigation());
    result.current.startNavigationToHit("/root/b.kif", CURSOR);

    stub.selectedNode = { path: "/root/b.kif", isDirectory: false };
    stub.kifuError = { path: "/root/b.kif" };
    rerender();

    stub.kifuError = null;
    stub.loadedAbsPath = "/root/b.kif";
    stub.player = {};
    rerender();

    expect(applyCursor).not.toHaveBeenCalled();
  });
});
