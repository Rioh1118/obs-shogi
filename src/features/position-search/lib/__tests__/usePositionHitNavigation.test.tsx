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
};

vi.mock("@/entities/file-tree", () => ({
  useFileTree: () => ({ selectedNode: stub.selectedNode, selectNodeByAbsPath }),
}));

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: { isLoading: false, loadedAbsPath: null },
    view: { player: stub.player },
    applyCursor,
  }),
}));

const { usePositionHitNavigation } = await import("../usePositionHitNavigation");

const CURSOR: CursorLite = { tesuu: 3, forkPointers: [] };

beforeEach(() => {
  stub.selectedNode = null;
  stub.player = null;
  selectNodeByAbsPath.mockReset();
  applyCursor.mockReset();
});

afterEach(() => cleanup());

describe("usePositionHitNavigation", () => {
  test("ツリーにその棋譜が無ければ false。局面も動かさない", () => {
    selectNodeByAbsPath.mockReturnValue(false);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.navigateToHit("/root/gone.kif", CURSOR)).toBe(false);
    expect(applyCursor).not.toHaveBeenCalled();
  });

  test("ツリーを切り替えられたら true（局面はファイルが読めてから当たる）", () => {
    selectNodeByAbsPath.mockReturnValue(true);

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.navigateToHit("/root/b.kif", CURSOR)).toBe(true);
    expect(selectNodeByAbsPath).toHaveBeenCalledWith("/root/b.kif");
  });

  test("同じ棋譜が既に開いていれば、その場で局面へ当てて true", () => {
    stub.selectedNode = { path: "/root/a.kif", isDirectory: false };
    stub.player = {};

    const { result } = renderHook(() => usePositionHitNavigation());

    expect(result.current.navigateToHit("/root/a.kif", CURSOR)).toBe(true);
    expect(selectNodeByAbsPath).not.toHaveBeenCalled();
    expect(applyCursor).toHaveBeenCalledTimes(1);
  });
});
