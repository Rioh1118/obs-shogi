// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 操作は IPC を2〜3往復してから「選択」と「開いている棋譜」を見る。
 * その窓のあいだ、利用者は別の棋譜を開ける。
 *
 * closure に閉じ込めた古い値で判断すると、開いたばかりの棋譜が閉じたり、
 * その内容が別のファイルへ書かれたりする。**ref から読むこと**を固定する。
 * 依存配列は closure を握ったままでも正しいので、`exhaustive-deps` は緑になる。
 */

const removeDir = vi.fn();
const renameDir = vi.fn();
const fetchTree = vi.fn();
const readKifu = vi.fn();

vi.mock("../../api/service", () => ({
  fetchTree: (...a: unknown[]) => fetchTree(...a),
  removeDir: (...a: unknown[]) => removeDir(...a),
  renameDir: (...a: unknown[]) => renameDir(...a),
  readKifu: (...a: unknown[]) => readKifu(...a),
  readText: vi.fn(),
  createKifu: vi.fn(),
  importKifu: vi.fn(),
  createDir: vi.fn(),
  removeFile: vi.fn(),
  renameFile: vi.fn(),
  moveFile: vi.fn(),
  moveDir: vi.fn(),
}));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ setRootDir: vi.fn().mockResolvedValue({ success: true }) }),
}));

vi.mock("@/entities/kifu/api/parse", () => ({
  parseKifuContentToJKF: () => ({ success: true, data: { header: {}, moves: [] } }),
}));

const { FileTreeProvider } = await import("../provider");
const { useFileTree } = await import("../useFileTree");

const A_DIR = "/ws/A";
const A_KIFU = "/ws/A/a.kif";
const B_KIFU = "/ws/b.kif";

const TREE = {
  id: "root",
  name: "ws",
  path: "/ws",
  isDirectory: true,
  displayInfo: { iconType: "folder" as const },
  children: [
    {
      id: "a",
      name: "A",
      path: A_DIR,
      isDirectory: true,
      displayInfo: { iconType: "folder" as const },
      children: [
        {
          id: "a1",
          name: "a.kif",
          path: "/ws/A/a.kif",
          isDirectory: false,
          displayInfo: { iconType: "kif-file" as const },
          kifuInfo: { format: "kif" as const },
        },
      ],
    },
    {
      id: "b",
      name: "b.kif",
      path: B_KIFU,
      isDirectory: false,
      displayInfo: { iconType: "kif-file" as const },
      kifuInfo: { format: "kif" as const },
    },
  ],
};

function findNode(path: string) {
  const walk = (n: typeof TREE): typeof TREE | undefined => {
    if (n.path === path) return n;
    for (const c of n.children ?? []) {
      const hit = walk(c as typeof TREE);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(TREE)!;
}

/** 削除の途中で別の棋譜を開けるように、操作の口を画面へ出す */
function Probe() {
  const { activeKifuPath, deleteNode, openKifuNode } = useFileTree();
  return (
    <div>
      <span data-testid="active">{activeKifuPath ?? "-"}</span>
      <button data-testid="delete-a" onClick={() => void deleteNode(findNode(A_DIR) as never)}>
        delete
      </button>
      <button data-testid="open-a" onClick={() => void openKifuNode(findNode(A_KIFU) as never)}>
        open a
      </button>
      <button data-testid="open-b" onClick={() => void openKifuNode(findNode(B_KIFU) as never)}>
        open b
      </button>
    </div>
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  fetchTree.mockResolvedValue({ success: true, data: TREE });
  readKifu.mockResolvedValue({ success: true, data: "" });
});

describe("IPC を跨いだあとの読み出し", () => {
  it("削除の途中で開いた棋譜を、削除の完了で閉じない", async () => {
    let finishDelete: () => void = () => {};
    removeDir.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDelete = () => resolve({ success: true, data: undefined });
        }),
    );

    render(
      <FileTreeProvider rootDir="/ws">
        <Probe />
      </FileTreeProvider>,
    );
    await act(async () => {});

    // A の中の棋譜を開く。この値が closure に閉じ込められる
    await act(async () => {
      screen.getByTestId("open-a").click();
    });
    expect(screen.getByTestId("active").textContent).toBe(A_KIFU);

    // A を消し始める
    await act(async () => {
      screen.getByTestId("delete-a").click();
    });

    // IPC の往復中に、A の外の棋譜 B を開く
    await act(async () => {
      screen.getByTestId("open-b").click();
    });
    expect(screen.getByTestId("active").textContent).toBe(B_KIFU);

    await act(async () => {
      finishDelete();
      await Promise.resolve();
    });

    // B は消したフォルダの中に無い。閉じてはいけない
    expect(screen.getByTestId("active").textContent).toBe(B_KIFU);
  });
});
