// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FileTreeNode } from "@/entities/file-tree";

/**
 * 棋譜の行を押したときに開き直すかの判定。「もう開いている」は盤にも訊く。
 *
 * ツリーの `activeKifuPath` は構文として読めた時点で進むので、そこから盤に
 * 載るまでの一段（`loadGame` の `buildPlayer`）で落ちた棋譜も「開いている」に
 * なる。その判定で2度目のクリックを捨てると、**復帰が別の棋譜を選ぶことだけに
 * なる**（`failure-surfacing.md` の F-31）。
 */

const openKifuNode = vi.fn(async () => ({ success: true as const, data: undefined }));
const selectNode = vi.fn();

const tree = {
  activeKifuPath: null as string | null,
  jkfData: {} as unknown,
  kifuFormat: "kif" as string | null,
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
  kifuInfo: { format: "kif" },
} as unknown as FileTreeNode;

const clickNode = () => {
  render(<FileNode node={NODE} level={1} />);
  fireEvent.click(screen.getByText("a.kif"));
};

beforeEach(() => {
  openKifuNode.mockClear();
  selectNode.mockClear();
  tree.activeKifuPath = null;
  tree.selectedNode = null;
  tree.jkfData = {};
  tree.kifuFormat = "kif";
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
   * `canSkipReopen` を `activeKifuPath` だけに戻すと、ここで押しても何も起きなくなる。
   */
  test("ツリーが開いたと言っていても、盤に載っていなければ開きに行く", () => {
    tree.activeKifuPath = "/ws/a.kif";
    game.loadedAbsPath = "/ws/前の.kif";

    clickNode();

    expect(openKifuNode).toHaveBeenCalledTimes(1);
  });

  /**
   * E16 のあとに前の棋譜へ戻る経路。盤には載っているが、ツリーは別のファイルを
   * 掴んだままになっている。
   *
   * `canSkipReopen` を `loadedAbsPath` だけにすると、ここで押しても何も起きない。盤は既にこの棋譜を
   * 出しているので利用者は戻れたと読むが、`activeKifuPath` は壊れた棋譜を指したままなので
   * `persistIfPossible` の検査（`entities/game` の `provider.tsx`）が以降の書き込みを全部
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

/**
 * 節の `id` は Rust が走査のたびに振り直す（`generate_id`）。reducer の `tree_loaded` は
 * `selectedNode` を張り替えないので、読み直した後の選択は前の走査の節のまま残る。
 * 行が `id` で比べると、棋譜は開いたまま強調だけが消える。
 */
describe("読み直した後の選択", () => {
  test("前の走査の節が選ばれていても、同じパスの行を強調する", () => {
    tree.selectedNode = { ...NODE, id: "前の走査" };

    render(<FileNode node={NODE} level={1} />);

    expect(screen.getByText("a.kif").closest(".node-box")?.className).toContain(
      "node-box__selected",
    );
  });

  test("強調するのは選んだパスの行だけ", () => {
    tree.selectedNode = { ...NODE, id: "前の走査" };
    const other = { ...NODE, id: "n2", name: "b.kif", path: "/ws/b.kif" };

    render(
      <>
        <FileNode node={NODE} level={1} />
        <FileNode node={other} level={1} />
      </>,
    );

    const selected = Array.from(document.querySelectorAll(".node-box__selected"));
    expect(selected).toEqual([screen.getByText("a.kif").closest(".node-box")]);
  });
});
