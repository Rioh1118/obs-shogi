// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { FileTreeNode } from "@/entities/file-tree";

/**
 * 行から呼ぶファイル操作の条件と引数。
 *
 * 改名とフォルダの作成はファイルシステムへ書くので、どの行で、どの名前で、
 * 何を渡すかを固定する。名前の検査そのものは `commitName` の試験が持つ。
 */

const ok = { success: true as const, data: undefined };

const tree = {
  toggleNode: vi.fn(),
  isNodeExpanded: vi.fn((_path: string) => true),
  openContextMenu: vi.fn(),
  creatingDirParentPath: null as string | null,
  cancelCreateDirectory: vi.fn(),
  renamingNodeId: null as string | null,
  renameNode: vi.fn(async (_node: FileTreeNode, _name: string) => ok),
  cancelInlineRename: vi.fn(),
  pushError: vi.fn(),
  createNewDirectory: vi.fn(async (_parent: string, _name: string) => ok),
  startCreateDirectory: vi.fn(),
  openKifuNode: vi.fn(async () => ok),
  activeKifuPath: null as string | null,
  selectedNode: null as FileTreeNode | null,
  selectNode: vi.fn(),
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

vi.mock("@/entities/game/model/useGame", async () => {
  const actual = await vi.importActual<typeof import("@/entities/game/model/useGame")>(
    "@/entities/game/model/useGame",
  );
  const mocked = { ...actual, useLoadedKifuPath: () => null };
  return mocked satisfies typeof import("@/entities/game/model/useGame");
});

const openModal = vi.fn();
vi.mock("@/shared/lib/router/useURLParams", async () => {
  const actual = await vi.importActual<typeof import("@/shared/lib/router/useURLParams")>(
    "@/shared/lib/router/useURLParams",
  );
  const mocked = {
    ...actual,
    useURLParams: () => ({ openModal }) as unknown as ReturnType<typeof actual.useURLParams>,
  };
  return mocked satisfies typeof import("@/shared/lib/router/useURLParams");
});

const { default: DirectoryNode } = await import("../DirectoryNode");
const { default: RootNode } = await import("../RootNode");
const { default: FileNode } = await import("../FileNode");

function nodeOf(path: string, isDirectory: boolean, children?: FileTreeNode[]): FileTreeNode {
  const name = path.split("/").pop() ?? path;
  return {
    id: `id:${path}`,
    name,
    path,
    isDirectory,
    children,
    displayInfo: { iconType: isDirectory ? "folder" : "kif-file" },
  } as FileTreeNode;
}

const KIFU = nodeOf("/ws/研究/a.kif", false);
const DIR = nodeOf("/ws/研究", true, [KIFU]);
const ROOT = nodeOf("/ws", true, [DIR]);

function inDnd(children: ReactNode) {
  return render(<DndContext>{children}</DndContext>);
}

function renderDir(node: FileTreeNode = DIR) {
  return inDnd(
    <DirectoryNode
      node={node}
      level={1}
      renderChild={(child) => <div key={child.path}>{child.name}</div>}
    />,
  );
}

async function typeAndEnter(value: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tree.isNodeExpanded.mockImplementation(() => true);
  tree.creatingDirParentPath = null;
  tree.renamingNodeId = null;
  tree.activeKifuPath = null;
  tree.selectedNode = null;
});

afterEach(cleanup);

describe("フォルダの行", () => {
  test("押すとそのフォルダを開閉する", () => {
    renderDir();

    fireEvent.click(screen.getByText("研究"));

    expect(tree.toggleNode).toHaveBeenCalledWith("/ws/研究");
  });

  test("改名の最中は押しても開閉しない", () => {
    tree.renamingNodeId = DIR.id;
    renderDir();

    fireEvent.click(screen.getByRole("textbox").closest(".node-box") as HTMLElement);

    expect(tree.toggleNode).not.toHaveBeenCalled();
  });

  test("閉じていれば子を描かない", () => {
    tree.isNodeExpanded.mockImplementation(() => false);
    renderDir();

    expect(screen.queryByText("a.kif")).toBeNull();
  });

  test("右クリックでその行のメニューを開く", () => {
    renderDir();

    fireEvent.contextMenu(screen.getByText("研究"), { clientX: 12, clientY: 34 });

    expect(tree.openContextMenu).toHaveBeenCalledWith(DIR, 12, 34);
  });

  test("改名を確定すると、その行と打った名前で renameNode を呼ぶ", async () => {
    tree.renamingNodeId = DIR.id;
    renderDir();

    await typeAndEnter("定跡");

    expect(tree.renameNode).toHaveBeenCalledTimes(1);
    expect(tree.renameNode).toHaveBeenCalledWith(DIR, "定跡");
    expect(tree.cancelInlineRename).toHaveBeenCalledTimes(1);
  });

  test("作成の行で確定すると、そのフォルダの中に作る", async () => {
    tree.creatingDirParentPath = DIR.path;
    renderDir();

    await typeAndEnter("新しい");

    expect(tree.createNewDirectory).toHaveBeenCalledWith("/ws/研究", "新しい");
    expect(tree.cancelCreateDirectory).toHaveBeenCalledTimes(1);
    expect(tree.renameNode).not.toHaveBeenCalled();
  });

  test("作成先が別のフォルダなら、作成の行を出さない", () => {
    tree.creatingDirParentPath = "/ws/別";
    renderDir();

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("閉じているフォルダには作成の行を出さない", () => {
    tree.creatingDirParentPath = DIR.path;
    tree.isNodeExpanded.mockImplementation(() => false);
    renderDir();

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("改名の最中は作成の行を出さない", () => {
    tree.creatingDirParentPath = DIR.path;
    tree.renamingNodeId = DIR.id;
    renderDir();

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveProperty("value", "研究");
  });

  test("指を乗せると、そのフォルダを作成先にした操作を出す", () => {
    renderDir();

    fireEvent.mouseEnter(screen.getByText("研究").closest(".node-box") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "新しいフォルダを作成" }));
    fireEvent.click(screen.getByRole("button", { name: "新しいファイルを作成" }));

    expect(tree.startCreateDirectory).toHaveBeenCalledWith("/ws/研究");
    expect(openModal).toHaveBeenCalledWith("create-file", { dir: "/ws/研究" }, { replace: false });
    expect(tree.toggleNode).not.toHaveBeenCalled();
  });

  test("指を離すと操作を引っ込める", () => {
    renderDir();
    const row = screen.getByText("研究").closest(".node-box") as HTMLElement;

    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);

    expect(screen.queryByRole("button", { name: "新しいフォルダを作成" })).toBeNull();
  });
});

describe("ルートの行", () => {
  const renderRoot = () => inDnd(<RootNode node={ROOT} />);

  test("押すと畳み、もう一度押すと開く", () => {
    renderRoot();

    expect(screen.getByText("研究")).toBeTruthy();
    fireEvent.click(screen.getByText("ws"));
    expect(screen.queryByText("研究")).toBeNull();
    fireEvent.click(screen.getByText("ws"));
    expect(screen.getByText("研究")).toBeTruthy();
  });

  test("改名の最中は押しても畳まない", () => {
    tree.renamingNodeId = ROOT.id;
    renderRoot();

    fireEvent.click(screen.getByDisplayValue("ws").closest(".node-box") as HTMLElement);

    expect(screen.getByText("研究")).toBeTruthy();
  });

  test("右クリックでルートのメニューを開く", () => {
    renderRoot();

    fireEvent.contextMenu(screen.getByText("ws"), { clientX: 1, clientY: 2 });

    expect(tree.openContextMenu).toHaveBeenCalledWith(ROOT, 1, 2);
  });

  test("改名を確定すると、ルートと打った名前で renameNode を呼ぶ", async () => {
    tree.renamingNodeId = ROOT.id;
    renderRoot();

    await typeAndEnter("ws2");

    expect(tree.renameNode).toHaveBeenCalledWith(ROOT, "ws2");
  });

  test("作成の行で確定すると、ルートの直下に作る", async () => {
    tree.creatingDirParentPath = ROOT.path;
    renderRoot();

    await typeAndEnter("新しい");

    expect(tree.createNewDirectory).toHaveBeenCalledWith("/ws", "新しい");
  });

  test("畳んでいる間は作成の行を出さない", () => {
    tree.creatingDirParentPath = ROOT.path;
    renderRoot();

    fireEvent.click(screen.getByText("ws"));

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("指を乗せると、ルートを作成先にした操作を出す", () => {
    renderRoot();

    fireEvent.mouseEnter(screen.getByText("ws").closest(".node-box") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "新しいフォルダを作成" }));

    expect(tree.startCreateDirectory).toHaveBeenCalledWith("/ws");
  });
});

describe("棋譜の行", () => {
  test("改名を確定すると、その行と打った名前で renameNode を呼ぶ", async () => {
    tree.renamingNodeId = KIFU.id;
    inDnd(<FileNode node={KIFU} level={2} />);

    await typeAndEnter("b.kif");

    expect(tree.renameNode).toHaveBeenCalledWith(KIFU, "b.kif");
  });

  test("改名の最中は押しても開かない", () => {
    tree.renamingNodeId = KIFU.id;
    inDnd(<FileNode node={KIFU} level={2} />);

    fireEvent.click(screen.getByRole("textbox").closest(".node-box") as HTMLElement);

    expect(tree.selectNode).not.toHaveBeenCalled();
    expect(tree.openKifuNode).not.toHaveBeenCalled();
  });

  test("押すとその行を選んで開く", () => {
    inDnd(<FileNode node={KIFU} level={2} />);

    fireEvent.click(screen.getByText("a.kif"));

    expect(tree.selectNode).toHaveBeenCalledWith(KIFU);
    expect(tree.openKifuNode).toHaveBeenCalledWith(KIFU);
  });

  test("右クリックでその行のメニューを開く", () => {
    inDnd(<FileNode node={KIFU} level={2} />);

    fireEvent.contextMenu(screen.getByText("a.kif"), { clientX: 5, clientY: 6 });

    expect(tree.openContextMenu).toHaveBeenCalledWith(KIFU, 5, 6);
  });
});
