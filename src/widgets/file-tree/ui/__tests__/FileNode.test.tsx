// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FileTreeNode } from "@/entities/file-tree";

/**
 * **「もう開いている」の判定は盤に訊く。**
 *
 * ツリーの `activeKifuPath` は構文として読めた時点で進むので、そこから盤に
 * 載るまでの一段（`loadGame` の `buildPlayer`）で落ちた棋譜も「開いている」に
 * なる。その関門で2度目のクリックを捨てると、**復帰が別の棋譜を選ぶことだけに
 * なる**（#434 / `failure-surfacing.md` の F-31）。
 */

const openKifuNode = vi.fn(async () => ({ success: true as const, data: undefined }));
const selectNode = vi.fn();

const tree = {
  activeKifuPath: null as string | null,
  selectedNode: null as FileTreeNode | null,
  openKifuNode,
  selectNode,
  openContextMenu: vi.fn(),
  renamingNodeId: null,
  renameNode: vi.fn(),
  cancelInlineRename: vi.fn(),
  pushError: vi.fn(),
};

const game = { state: { loadedAbsPath: null as string | null } };

vi.mock("@/entities/file-tree", () => ({
  useFileTree: () => tree,
  commitName: vi.fn(),
}));
vi.mock("@/entities/game", () => ({ useGame: () => game }));

const { default: FileNode } = await import("../FileNode");

const NODE = {
  id: "n1",
  name: "a.kif",
  path: "/ws/a.kif",
  isDirectory: false,
  displayInfo: { iconType: "kifu" },
} as unknown as FileTreeNode;

const clickNode = () => {
  render(<FileNode node={NODE} level={1} />);
  fireEvent.click(screen.getByText("a.kif"));
};

beforeEach(() => {
  openKifuNode.mockClear();
  selectNode.mockClear();
  tree.activeKifuPath = null;
  game.state.loadedAbsPath = null;
});

afterEach(() => cleanup());

describe("棋譜のノードを押したとき", () => {
  test("盤に載っていなければ開きに行く", () => {
    clickNode();

    expect(openKifuNode).toHaveBeenCalledTimes(1);
  });

  test("盤に載っていれば開き直さない", () => {
    game.state.loadedAbsPath = "/ws/a.kif";
    tree.activeKifuPath = "/ws/a.kif";

    clickNode();

    expect(selectNode).toHaveBeenCalledTimes(1);
    expect(openKifuNode).not.toHaveBeenCalled();
  });

  /**
   * E16 のあとの状態。ツリーは開いたと言っているが、盤には載っていない。
   * 関門を `activeKifuPath` に戻すと、ここで押しても何も起きなくなる。
   */
  test("ツリーが開いたと言っていても、盤に載っていなければ開きに行く", () => {
    tree.activeKifuPath = "/ws/a.kif";
    game.state.loadedAbsPath = "/ws/前の.kif";

    clickNode();

    expect(openKifuNode).toHaveBeenCalledTimes(1);
  });
});
