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

const game = { loadedAbsPath: null as string | null };

vi.mock("@/entities/file-tree", () => ({
  useFileTree: () => tree,
  commitName: vi.fn(),
}));
vi.mock("@/entities/game", () => ({ useLoadedKifuPath: () => game.loadedAbsPath }));

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
  game.loadedAbsPath = null;
});

afterEach(() => cleanup());

describe("棋譜のノードを押したとき", () => {
  test("盤に載っていなければ開きに行く", () => {
    clickNode();

    expect(openKifuNode).toHaveBeenCalledTimes(1);
  });

  test("盤に載っていれば開き直さない", () => {
    game.loadedAbsPath = "/ws/a.kif";
    tree.activeKifuPath = "/ws/a.kif";

    clickNode();

    expect(selectNode).toHaveBeenCalledTimes(1);
    expect(openKifuNode).not.toHaveBeenCalled();
  });

  /**
   * E16 のあとの状態。ツリーは開いたと言っているが、盤には載っていない。
   * 関門を `activeKifuPath` だけに戻すと、ここで押しても何も起きなくなる。
   */
  test("ツリーが開いたと言っていても、盤に載っていなければ開きに行く", () => {
    tree.activeKifuPath = "/ws/a.kif";
    game.loadedAbsPath = "/ws/前の.kif";

    clickNode();

    expect(openKifuNode).toHaveBeenCalledTimes(1);
  });

  /**
   * **E16 のあとに前の棋譜へ戻る経路。** 盤には載っているが、ツリーは別のファイルを
   * 掴んだままになっている。
   *
   * 関門を `loadedAbsPath` だけにすると、ここで押しても何も起きない。盤は既にこの棋譜を
   * 出しているので利用者は戻れたと読むが、`activeKifuPath` は壊れた棋譜を指したままなので
   * `persistIfPossible` の門番（`entities/game` の `provider.tsx`）が以降の書き込みを全部
   * 止める——**指した手が一瞬出てから黙って戻る**状態になり、抜けるには第3のファイルを
   * 押すしかなくなる。
   */
  test("盤に載っていても、ツリーが別のファイルを掴んでいれば開き直しに行く", () => {
    game.loadedAbsPath = "/ws/a.kif";
    tree.activeKifuPath = "/ws/こわれた.kif";

    clickNode();

    expect(openKifuNode).toHaveBeenCalledTimes(1);
  });
});
