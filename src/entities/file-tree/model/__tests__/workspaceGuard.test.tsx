// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **開いている棋譜は、いまのワークスペースの中にある。**
 *
 * ここが破れると `GamePersistenceGate` が旧ワークスペースのパスへ書き続ける。
 * 画面には前のワークスペースの棋譜が出たままなので、1手指すかコメントを1つ保存すると
 * **別のワークスペースのファイルが黙って書き換わる**。→ #245
 *
 * ツリーの取得が**失敗しても**閉じることを見る。成功したときだけ閉じる形だと、
 * `reload_failed` がツリーを残すぶん `activeKifuPath` も据え置かれる。
 */

const fetchTree = vi.fn();
const readKifu = vi.fn();

vi.mock("../../api/service", () => ({
  fetchTree: (...a: unknown[]) => fetchTree(...a),
  readKifu: (...a: unknown[]) => readKifu(...a),
  readText: vi.fn(),
  createKifu: vi.fn(),
  importKifu: vi.fn(),
  createDir: vi.fn(),
  removeFile: vi.fn(),
  removeDir: vi.fn(),
  renameFile: vi.fn(),
  renameDir: vi.fn(),
  moveFile: vi.fn(),
  moveDir: vi.fn(),
}));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ setRootDir: vi.fn().mockResolvedValue({ success: true }) }),
}));

vi.mock("@/entities/kifu/api/parse", () => ({
  parseKifuContentToJKF: () => ({ header: {}, moves: [{}] }),
}));

const { FileTreeProvider } = await import("../provider");
const { useFileTree } = await import("../useFileTree");

const WS_A = "/ws/A";
const WS_B = "/ws/B";
const A_KIFU = "/ws/A/a.kif";

const A_NODE = {
  id: "a1",
  name: "a.kif",
  path: A_KIFU,
  isDirectory: false,
  displayInfo: { iconType: "kif-file" as const },
  kifuInfo: { format: "kif" as const },
};

const TREE_A = {
  id: "rootA",
  name: "A",
  path: WS_A,
  isDirectory: true,
  displayInfo: { iconType: "folder" as const },
  children: [A_NODE],
};

function Probe() {
  const { activeKifuPath, openKifuNode } = useFileTree();
  return (
    <div>
      <span data-testid="active">{activeKifuPath ?? "-"}</span>
      <button data-testid="open-a" onClick={() => void openKifuNode(A_NODE as never)}>
        open
      </button>
    </div>
  );
}

async function openKifuInWorkspaceA() {
  const view = render(
    <FileTreeProvider rootDir={WS_A}>
      <Probe />
    </FileTreeProvider>,
  );
  await act(async () => {});
  await act(async () => {
    screen.getByTestId("open-a").click();
  });
  expect(screen.getByTestId("active").textContent).toBe(A_KIFU);
  return view;
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  fetchTree.mockResolvedValue({ success: true, data: TREE_A });
  readKifu.mockResolvedValue({ success: true, data: "" });
});

describe("ワークスペースを変えたときの棋譜", () => {
  it("新しい根の外に出た棋譜は、ツリーの取得が失敗しても閉じる", async () => {
    const view = await openKifuInWorkspaceA();

    // B のツリーが取れない（権限・パスの消失・マウント外れ）
    fetchTree.mockResolvedValue({
      success: false,
      error: { code: "permission_denied", message: "denied", path: WS_B },
    });

    await act(async () => {
      view.rerender(
        <FileTreeProvider rootDir={WS_B}>
          <Probe />
        </FileTreeProvider>,
      );
    });

    expect(screen.getByTestId("active").textContent).toBe("-");
  });

  it("新しい根が前の根の親なら、棋譜は開いたまま", async () => {
    // `/ws` は `/ws/A/a.kif` を含むので、閉じる理由が無い。
    // 「根が変わったら常に閉じる」に単純化すると、この経路で棋譜が消える。
    const view = await openKifuInWorkspaceA();

    fetchTree.mockResolvedValue({
      success: true,
      data: { ...TREE_A, id: "rootWs", name: "ws", path: "/ws", children: [TREE_A] },
    });

    await act(async () => {
      view.rerender(
        <FileTreeProvider rootDir="/ws">
          <Probe />
        </FileTreeProvider>,
      );
    });

    expect(screen.getByTestId("active").textContent).toBe(A_KIFU);
  });

  it("名前の先頭が一致するだけの兄弟ディレクトリは、中に入っていない", async () => {
    // 開いているのは `/ws/AB/x.kif`。新しい根は `/ws/A` で、`AB` は `A` の中ではない。
    // `startsWith(rootDir)` だけで判定すると true になり、**別のワークスペースの
    // ファイルを開いたまま**そこへ書き続ける。区切り文字まで見ること。
    const AB_KIFU = "/ws/AB/x.kif";
    const AB_NODE = { ...A_NODE, id: "ab1", name: "x.kif", path: AB_KIFU };
    fetchTree.mockResolvedValue({
      success: true,
      data: { ...TREE_A, id: "rootAB", name: "AB", path: "/ws/AB", children: [AB_NODE] },
    });

    function AbProbe() {
      const { activeKifuPath, openKifuNode } = useFileTree();
      return (
        <div>
          <span data-testid="active">{activeKifuPath ?? "-"}</span>
          <button data-testid="open-ab" onClick={() => void openKifuNode(AB_NODE as never)}>
            open
          </button>
        </div>
      );
    }

    const view = render(
      <FileTreeProvider rootDir="/ws/AB">
        <AbProbe />
      </FileTreeProvider>,
    );
    await act(async () => {});
    await act(async () => {
      screen.getByTestId("open-ab").click();
    });
    expect(screen.getByTestId("active").textContent).toBe(AB_KIFU);

    // 取得を失敗させる。成功させると、ツリーに見つからない棋譜を閉じる既存の効果
    // （`findNodeChain` が null）が先に閉じてしまい、**この判定を通らなくても緑になる。**
    fetchTree.mockResolvedValue({
      success: false,
      error: { code: "permission_denied", message: "denied", path: WS_A },
    });
    await act(async () => {
      view.rerender(
        <FileTreeProvider rootDir={WS_A}>
          <AbProbe />
        </FileTreeProvider>,
      );
    });

    expect(screen.getByTestId("active").textContent).toBe("-");
  });
});
