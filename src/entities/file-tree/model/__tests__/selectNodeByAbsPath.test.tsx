// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`forceReopen` を受け手が守ること。**
 *
 * ツリーが握っている3つ（`activeKifuPath` / `jkfData` / `kifuFormat`）は「構文として
 * 読めた」までしか言わない。盤に載ったかは呼び出し側にしか分からないので、
 * 覆せるようにしてある。**受け手が覆されなければ**、盤に載せられなかった棋譜への
 * 2度目の要求が `openKifuNode` ごと飛ばされ、モーダルだけが閉じて何も起きない
 * （`failure-surfacing.md` の F-31 / 検索ヒットの経路）。
 *
 * 呼び手が `forceReopen` を渡すことは `usePositionHitNavigation.test.tsx` が見ている。
 * **ここは受け手側**——2段のうち後段。
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

const WS = "/ws";
const A_KIFU = "/ws/a.kif";

const A_NODE = {
  id: "a1",
  name: "a.kif",
  path: A_KIFU,
  isDirectory: false,
  displayInfo: { iconType: "kif-file" as const },
  kifuInfo: { format: "kif" as const },
};

const TREE = {
  id: "root",
  name: "ws",
  path: WS,
  isDirectory: true,
  displayInfo: { iconType: "folder" as const },
  children: [A_NODE],
};

function Probe() {
  const { activeKifuPath, openKifuNode, selectNodeByAbsPath } = useFileTree();
  return (
    <div>
      <span data-testid="active">{activeKifuPath ?? "-"}</span>
      <button data-testid="open" onClick={() => void openKifuNode(A_NODE as never)}>
        open
      </button>
      <button
        data-testid="force"
        onClick={() => selectNodeByAbsPath(A_KIFU, { forceReopen: true })}
      >
        force
      </button>
      <button
        data-testid="skip"
        onClick={() => selectNodeByAbsPath(A_KIFU, { forceReopen: false })}
      >
        skip
      </button>
    </div>
  );
}

/** ツリーから1度開いた状態にする（`activeKifuPath` / `jkfData` / `kifuFormat` が揃う） */
async function openOnce() {
  render(
    <FileTreeProvider rootDir={WS}>
      <Probe />
    </FileTreeProvider>,
  );
  await act(async () => {});
  await act(async () => {
    screen.getByTestId("open").click();
  });
  expect(screen.getByTestId("active").textContent).toBe(A_KIFU);
  readKifu.mockClear();
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  fetchTree.mockResolvedValue({ success: true, data: TREE });
  readKifu.mockResolvedValue({ success: true, data: "" });
});

describe("selectNodeByAbsPath の開き直し", () => {
  it("`forceReopen: true` なら、ツリーが開いていると言っていても読み直す", async () => {
    await openOnce();

    await act(async () => {
      screen.getByTestId("force").click();
    });

    expect(readKifu).toHaveBeenCalledTimes(1);
  });

  it("`forceReopen: false` なら読み直さない", async () => {
    await openOnce();

    await act(async () => {
      screen.getByTestId("skip").click();
    });

    expect(readKifu).not.toHaveBeenCalled();
  });
});
