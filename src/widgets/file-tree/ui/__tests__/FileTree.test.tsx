// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

import type { FsError } from "@/entities/file-tree/api/error";

/**
 * ツリー取得の失敗とファイル操作の失敗は、どちらも同じ `state.error` に積まれる。
 * 固定したいのは「ツリーが残っているなら消さない」こと。消すとそこからの操作が
 * 全部できなくなり、復帰路まで失う（`docs/state-transitions/file-tree.md` の S3）。
 */

const stub = {
  fileTree: null as { path: string; name: string } | null,
  isLoading: false,
  error: null as FsError | null,
};

const clearError = vi.fn();
const refreshTree = vi.fn(async () => ({ success: true }) as const);

vi.mock("@/entities/file-tree/model/useFileTree", () => ({
  useFileTree: () => ({
    fileTree: stub.fileTree,
    isLoading: stub.isLoading,
    error: stub.error,
    menu: null,
    deleteNode: vi.fn(),
    moveNode: vi.fn(),
    closeContextMenu: vi.fn(),
    startInlineRename: vi.fn(),
    clearError,
    refreshTree,
  }),
}));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { root_dir: "/root" } }),
}));

// ツリーが描かれたかだけを見たいので、中身は差し替える
vi.mock("../RootNode", () => ({
  default: ({ node }: { node: { name: string } }) => <div data-testid="tree">{node.name}</div>,
}));

const { default: FileTree } = await import("../FileTree");

const TREE = { path: "/root", name: "root" };
const IO_ERROR: FsError = { code: "io", message: "os error 5", path: "/root/a.kif" };

beforeEach(() => {
  stub.fileTree = null;
  stub.isLoading = false;
  stub.error = null;
  clearError.mockClear();
  refreshTree.mockClear();
});

// globals を有効にしていないので自動 cleanup が効かない。
// Modal は body へ portal するため、消さないと次のテストに残る
afterEach(cleanup);

describe("FileTree の失敗表示", () => {
  test("ファイル操作が失敗しても、ツリーは残る", () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    expect(screen.getByTestId("tree")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("読み書きに失敗しました");
  });

  test("失敗した対象のパスが出る", () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    expect(screen.getByRole("alert").textContent).toContain("/root/a.kif");
  });

  test("Rust の生メッセージは畳んだ中に置き、そのまま本文にしない", () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    const detail = screen.getByText("技術的な詳細").closest("details");
    expect(detail).toBeTruthy();
    expect(detail!.hasAttribute("open")).toBe(false);
    expect(detail!.textContent).toContain("os error 5");
  });

  test("ツリーがまだ無いときは、その場に失敗を出す", () => {
    stub.fileTree = null;
    stub.error = { code: "permission_denied", message: "denied" };

    render(<FileTree />);

    expect(screen.queryByTestId("tree")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("権限がありません");
    // 「ルートディレクトリを選択してください」を出すと、原因を取り違えさせる
    expect(screen.queryByText(/ルートディレクトリを選択/)).toBeNull();
  });

  test("再読み込みで復帰できる", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    await act(async () => {
      screen.getByRole("button", { name: "再読み込み" }).click();
    });

    expect(refreshTree).toHaveBeenCalledTimes(1);
  });

  test("ツリーが残っているときは閉じられる", async () => {
    stub.fileTree = TREE;
    stub.error = IO_ERROR;

    render(<FileTree />);

    await act(async () => {
      screen.getByRole("button", { name: "閉じる" }).click();
    });

    expect(clearError).toHaveBeenCalledTimes(1);
  });

  test("ツリーが無いときは閉じるを出さない。閉じても何も出せない", () => {
    stub.fileTree = null;
    stub.error = IO_ERROR;

    render(<FileTree />);

    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
  });

  test("失敗が無ければ何も出さない", () => {
    stub.fileTree = TREE;
    stub.error = null;

    render(<FileTree />);

    expect(screen.getByTestId("tree")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
