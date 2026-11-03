// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { memo } from "react";
import type { DndContextProps, DragEndEvent } from "@dnd-kit/core";
import type { FileTreeNode } from "@/entities/file-tree";

/**
 * ツリーから呼ぶ削除と移動の条件と引数。
 *
 * どちらもファイルシステムへすぐ書くので、確認を挟むこと、何もしない落とし先、
 * 渡す節と行き先を固定する。ドラッグは happy-dom では当たり判定が取れないので、
 * `DndContext` に渡った `onDragEnd` を直接呼ぶ。
 */

const ok = { success: true as const, data: undefined };

function nodeOf(path: string, isDirectory: boolean, children?: FileTreeNode[]): FileTreeNode {
  return {
    id: `id:${path}`,
    name: path.split("/").pop() ?? path,
    path,
    isDirectory,
    children,
    displayInfo: { iconType: isDirectory ? "folder" : "kif-file" },
  } as FileTreeNode;
}

const KIFU = nodeOf("/ws/研究/a.kif", false);
const SUB = nodeOf("/ws/研究/深い", true, []);
const DIR = nodeOf("/ws/研究", true, [KIFU, SUB]);
const OTHER = nodeOf("/ws/別", true, []);
const ROOT = nodeOf("/ws", true, [DIR, OTHER]);

const tree = {
  fileTree: ROOT as FileTreeNode | null,
  isLoading: false,
  error: null,
  menu: null as { node: FileTreeNode; x: number; y: number } | null,
  deleteNode: vi.fn(async (_node: FileTreeNode) => ok),
  moveNode: vi.fn(async (_node: FileTreeNode, _dest: string) => ok),
  closeContextMenu: vi.fn(),
  startInlineRename: vi.fn(),
  clearError: vi.fn(),
  refreshTree: vi.fn(async () => ok),
};

vi.mock("@/entities/file-tree/model/useFileTree", () => {
  const mocked = {
    useFileTree: () =>
      tree as unknown as ReturnType<
        typeof import("@/entities/file-tree/model/useFileTree").useFileTree
      >,
  };
  return mocked satisfies typeof import("@/entities/file-tree/model/useFileTree");
});

vi.mock("@/features/settings/model/useOpenSettings", () => {
  const openSettings = vi.fn();
  const mocked = { useOpenSettings: () => openSettings };
  return mocked satisfies typeof import("@/features/settings/model/useOpenSettings");
});

let dndProps: DndContextProps | null = null;
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  const mocked = {
    ...actual,
    DndContext: memo(function SpyDndContext(props: DndContextProps) {
      dndProps = props;
      return <actual.DndContext {...props} />;
    }),
  };
  return mocked satisfies typeof import("@dnd-kit/core");
});

// 行の描き方はこの試験の外。ツリーが描かれたことだけ分かればよい
vi.mock("../RootNode", () => {
  const mocked = { default: () => <div>ツリー</div> };
  return mocked satisfies typeof import("../RootNode");
});

const { default: FileTree } = await import("../FileTree");

beforeEach(() => {
  vi.clearAllMocks();
  tree.fileTree = ROOT;
  tree.menu = null;
  dndProps = null;
});

afterEach(cleanup);

async function drop(srcPath: string, destDir: string | undefined) {
  render(<FileTree />);
  const event = {
    active: { id: srcPath },
    over: destDir === undefined ? null : { data: { current: { kind: "drop", destDir } } },
  } as unknown as DragEndEvent;
  await act(async () => {
    await dndProps?.onDragEnd?.(event);
  });
}

describe("ドラッグで移す", () => {
  test("別のフォルダへ落とすと、その節と行き先で moveNode を呼ぶ", async () => {
    await drop(KIFU.path, OTHER.path);

    expect(tree.moveNode).toHaveBeenCalledTimes(1);
    expect(tree.moveNode).toHaveBeenCalledWith(KIFU, "/ws/別");
  });

  test("フォルダを別のフォルダへ移せる", async () => {
    await drop(DIR.path, OTHER.path);

    expect(tree.moveNode).toHaveBeenCalledWith(DIR, "/ws/別");
  });

  test("落とし先が無ければルートへ移す", async () => {
    await drop(KIFU.path, undefined);

    expect(tree.moveNode).toHaveBeenCalledWith(KIFU, "/ws");
  });

  test("今いるフォルダへ落としても移さない", async () => {
    await drop(KIFU.path, DIR.path);

    expect(tree.moveNode).not.toHaveBeenCalled();
  });

  test("フォルダを自分自身へ落としても移さない", async () => {
    await drop(SUB.path, SUB.path);

    expect(tree.moveNode).not.toHaveBeenCalled();
  });

  test("フォルダを自分の中へ落としても移さない", async () => {
    await drop(DIR.path, SUB.path);

    expect(tree.moveNode).not.toHaveBeenCalled();
  });

  test("名前の頭が同じだけの隣のフォルダへは移せる", async () => {
    const sibling = nodeOf("/ws/研究2", true, []);
    tree.fileTree = { ...ROOT, children: [DIR, sibling] } as FileTreeNode;

    await drop(DIR.path, sibling.path);

    expect(tree.moveNode).toHaveBeenCalledWith(DIR, "/ws/研究2");
  });

  test("ツリーに無い節は移さない", async () => {
    await drop("/ws/消えた.kif", OTHER.path);

    expect(tree.moveNode).not.toHaveBeenCalled();
  });

  test("ツリーが無ければ移さない", async () => {
    tree.fileTree = null;

    await drop(KIFU.path, undefined);

    expect(tree.moveNode).not.toHaveBeenCalled();
  });
});

describe("右クリックのメニュー", () => {
  function openMenuOn(node: FileTreeNode) {
    tree.menu = { node, x: 3, y: 4 };
    render(<FileTree />);
  }

  test("ルートには改名だけを出す", () => {
    openMenuOn(ROOT);

    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Rename"]);
  });

  test("ルート以外には改名と削除を出す", () => {
    openMenuOn(DIR);

    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Rename",
      "Delete",
    ]);
  });

  test("改名を押すと、その節の改名を始める", async () => {
    openMenuOn(KIFU);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    });

    expect(tree.startInlineRename).toHaveBeenCalledWith(KIFU);
    expect(tree.closeContextMenu).toHaveBeenCalled();
  });

  test("削除は確認を挟む。押しただけでは消さない", async () => {
    openMenuOn(KIFU);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });

    expect(screen.getByText("「a.kif」を削除しますか？")).toBeTruthy();
    expect(tree.deleteNode).not.toHaveBeenCalled();
  });

  test("確認で削除すると、その節で deleteNode を1回呼んで確認を閉じる", async () => {
    openMenuOn(KIFU);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    });

    expect(tree.deleteNode).toHaveBeenCalledTimes(1);
    expect(tree.deleteNode).toHaveBeenCalledWith(KIFU);
    expect(screen.queryByText("「a.kif」を削除しますか？")).toBeNull();
  });

  test("確認でキャンセルすると消さない", async () => {
    openMenuOn(KIFU);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(tree.deleteNode).not.toHaveBeenCalled();
    expect(screen.queryByText("「a.kif」を削除しますか？")).toBeNull();
  });

  test("フォルダの削除は中身も消えると書く", async () => {
    openMenuOn(DIR);

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });

    expect(screen.getByText("「研究」フォルダを削除しますか？")).toBeTruthy();
    expect(screen.getByText(/フォルダ内のファイルもすべて完全に削除されます/)).toBeTruthy();
  });
});
