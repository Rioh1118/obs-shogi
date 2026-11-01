// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 開いている棋譜の改名と移動は、棋譜を閉じない。
 *
 * パスの張り替えはツリーの読み直しより先に state へ入る。IPC の応答は macrotask なので、
 * 本番ではその間に描画が挟まる。新しいパスを古いツリーで引くと「ツリーに無い棋譜」に見え、
 * 閉じると盤が空になる（`docs/spec/screens/file-tree.md`）。
 *
 * `fetchTree` を deferred にして描画を挟む。すぐ解決する mock では描画が挟まらず緑になる。
 */

const fetchTree = vi.fn();
const readKifu = vi.fn();
const renameFile = vi.fn();
const moveFile = vi.fn();
const renameDir = vi.fn();
/** `setRootDir` が `rootDir` を変える連鎖を、`App` の state で再現する */
const rootDir = vi.hoisted(() => ({ set: (_path: string) => {} }));

vi.mock(
  "../../api/service",
  () =>
    ({
      fetchTree: (...a: unknown[]) => fetchTree(...a),
      readKifu: (...a: unknown[]) => readKifu(...a),
      renameFile: (...a: unknown[]) => renameFile(...a),
      moveFile: (...a: unknown[]) => moveFile(...a),
      renameDir: (...a: unknown[]) => renameDir(...a),
      readText: vi.fn(),
      createKifu: vi.fn(),
      importKifu: vi.fn(),
      createDir: vi.fn(),
      removeFile: vi.fn(),
      removeDir: vi.fn(),
      moveDir: vi.fn(),
    }) satisfies typeof import("../../api/service"),
);

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  return {
    ...actual,
    useAppConfig: () =>
      ({
        setRootDir: (path: string) => {
          rootDir.set(path);
          return Promise.resolve({ success: true, data: undefined });
        },
      }) as never,
  } satisfies typeof import("@/entities/app-config");
});

vi.mock("@/entities/kifu/api/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/kifu/api/parse")>();
  return {
    ...actual,
    parseKifuContentToJKF: () => ({ header: {}, moves: [{}] }) as never,
  } satisfies typeof import("@/entities/kifu/api/parse");
});

const { FileTreeProvider } = await import("../provider");
const { useFileTree } = await import("../useFileTree");

type Node = {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  displayInfo: { iconType: "folder" | "kif-file" };
  kifuInfo?: { format: "kif" };
  children?: Node[];
};

const kifu = (path: string): Node => ({
  id: path,
  name: path,
  path,
  isDirectory: false,
  displayInfo: { iconType: "kif-file" },
  kifuInfo: { format: "kif" },
});
const dir = (path: string, children: Node[]): Node => ({
  id: path,
  name: path,
  path,
  isDirectory: true,
  displayInfo: { iconType: "folder" },
  children,
});

const OLD_KIFU = kifu("/ws/a.kif");
const OLD_TREE = dir("/ws", [OLD_KIFU]);
const NEW_TREE = dir("/ws", [kifu("/ws/b.kif")]);
const OTHER_KIFU = kifu("/ws/c.kif");

const ok = <T,>(data: T) => ({ success: true, data });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Probe() {
  const {
    fileTree,
    activeKifuPath,
    selectedNode,
    selectNode,
    openKifuNode,
    renameNode,
    moveNode,
    refreshTree,
  } = useFileTree();
  const node = fileTree?.children?.[0] as never;
  return (
    <div>
      <span data-testid="active">{activeKifuPath ?? "-"}</span>
      <span data-testid="selected">{selectedNode?.path ?? "-"}</span>
      <button
        data-testid="open"
        onClick={() => {
          selectNode(node);
          void openKifuNode(node); // async-result-ignored: 開くところはこの検査の対象でない
        }}
      />
      <button
        data-testid="rename"
        onClick={() => {
          void renameNode(node, "b.kif"); // async-result-ignored: 結果は state で見る
        }}
      />
      <button
        data-testid="open-other"
        onClick={() => {
          selectNode(OTHER_KIFU as never);
          void openKifuNode(OTHER_KIFU as never); // async-result-ignored: 開くところは見ない
        }}
      />
      <button
        data-testid="rename-again"
        onClick={() => {
          void renameNode(kifu("/ws/b.kif") as never, "e.kif"); // async-result-ignored: state で見る
        }}
      />
      <button
        data-testid="rename-root"
        onClick={() => {
          void renameNode(fileTree as never, "ws2"); // async-result-ignored: 結果は state で見る
        }}
      />
      <button
        data-testid="refresh"
        onClick={() => {
          void refreshTree(); // async-result-ignored: 結果は state で見る
        }}
      />
      <button
        data-testid="move"
        onClick={() => {
          void moveNode(node, "/ws/d"); // async-result-ignored: 結果は state で見る
        }}
      />
    </div>
  );
}

function App() {
  const [root, setRoot] = useState("/ws");
  rootDir.set = setRoot;
  return (
    <FileTreeProvider rootDir={root}>
      <Probe />
    </FileTreeProvider>
  );
}

async function openKifu() {
  render(<App />);
  await act(async () => {});
  await act(async () => {
    screen.getByTestId("open").click();
  });
  expect(screen.getByTestId("active").textContent).toBe("/ws/a.kif");
  expect(screen.getByTestId("selected").textContent).toBe("/ws/a.kif");
}

const shown = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  fetchTree.mockReset();
  readKifu.mockReset();
  renameFile.mockReset();
  moveFile.mockReset();
  renameDir.mockReset();
  fetchTree.mockResolvedValue(ok(OLD_TREE));
  readKifu.mockResolvedValue(ok("本文"));
});

afterEach(cleanup);

describe("開いている棋譜の改名", () => {
  it("読み直しの応答を待つ間に描画が挟まっても、棋譜は開いたまま", async () => {
    await openKifu();
    const reload = deferred<unknown>();
    fetchTree.mockReturnValue(reload.promise);
    renameFile.mockResolvedValue(ok("/ws/b.kif"));

    await act(async () => {
      screen.getByTestId("rename").click();
    });

    // 張り替えは済み、ツリーはまだ古い。この隙間で閉じると盤が空になる
    expect(fetchTree).toHaveBeenCalledTimes(2);
    expect(shown("active")).toBe("/ws/b.kif");

    await act(async () => {
      reload.resolve(ok(NEW_TREE));
    });

    expect(shown("active")).toBe("/ws/b.kif");
    expect(shown("selected")).toBe("/ws/b.kif");
  });

  it("読み直しが落ちても、棋譜は新しいパスで開いたまま", async () => {
    await openKifu();
    const reload = deferred<unknown>();
    fetchTree.mockReturnValue(reload.promise);
    renameFile.mockResolvedValue(ok("/ws/b.kif"));

    await act(async () => {
      screen.getByTestId("rename").click();
    });
    await act(async () => {
      reload.resolve({ success: false, error: { code: "io", message: "x" } });
    });

    expect(shown("active")).toBe("/ws/b.kif");
  });
});

describe("開いている棋譜があるルートの改名", () => {
  it("新しいルートの読み直しを待つ間も、棋譜は新しいパスで開いたまま", async () => {
    await openKifu();
    const reload = deferred<unknown>();
    fetchTree.mockReturnValue(reload.promise);
    renameDir.mockResolvedValue(ok("/ws2"));

    await act(async () => {
      screen.getByTestId("rename-root").click();
    });

    expect(fetchTree).toHaveBeenLastCalledWith("/ws2");
    expect(shown("active")).toBe("/ws2/a.kif");

    await act(async () => {
      reload.resolve(ok(dir("/ws2", [kifu("/ws2/a.kif")])));
    });

    expect(shown("active")).toBe("/ws2/a.kif");
    expect(shown("selected")).toBe("/ws2/a.kif");
  });
});

describe("開いている棋譜の移動", () => {
  it("読み直しの応答を待つ間に描画が挟まっても、棋譜は開いたまま", async () => {
    await openKifu();
    const reload = deferred<unknown>();
    fetchTree.mockReturnValue(reload.promise);
    moveFile.mockResolvedValue(ok("/ws/b.kif"));

    await act(async () => {
      screen.getByTestId("move").click();
    });

    expect(shown("active")).toBe("/ws/b.kif");

    await act(async () => {
      reload.resolve(ok(NEW_TREE));
    });

    expect(shown("active")).toBe("/ws/b.kif");
    expect(shown("selected")).toBe("/ws/b.kif");
  });
});

describe("ツリーから棋譜が消えたとき", () => {
  it("読み直したツリーに無い棋譜は閉じる", async () => {
    await openKifu();
    fetchTree.mockResolvedValue(ok(dir("/ws", [])));

    await act(async () => {
      screen.getByTestId("refresh").click();
    });

    expect(shown("active")).toBe("-");
  });
});

describe("保留の選択", () => {
  async function renameThenFailReload() {
    await openKifu();
    fetchTree.mockResolvedValue({ success: false, error: { code: "io", message: "x" } });
    renameFile.mockResolvedValue(ok("/ws/b.kif"));
    await act(async () => {
      screen.getByTestId("rename").click();
    });
    expect(shown("active")).toBe("/ws/b.kif");
    expect(shown("selected")).toBe("/ws/a.kif");
  }

  it("読み直しが落ちたあとの次の読み直しで、選択が張り替わる", async () => {
    await renameThenFailReload();
    fetchTree.mockResolvedValue(ok(NEW_TREE));

    await act(async () => {
      screen.getByTestId("refresh").click();
    });

    expect(shown("selected")).toBe("/ws/b.kif");
    expect(shown("active")).toBe("/ws/b.kif");
  });

  it("選び直したら、保留が選択を上書きしない", async () => {
    await renameThenFailReload();
    await act(async () => {
      screen.getByTestId("open-other").click();
    });
    expect(shown("active")).toBe("/ws/c.kif");
    fetchTree.mockResolvedValue(ok(dir("/ws", [kifu("/ws/b.kif"), OTHER_KIFU])));

    await act(async () => {
      screen.getByTestId("refresh").click();
    });

    expect(shown("selected")).toBe("/ws/c.kif");
    expect(shown("active")).toBe("/ws/c.kif");
  });

  it("保留のあいだの2度目の改名は、保留を起点に張り替える", async () => {
    await renameThenFailReload();
    renameFile.mockResolvedValue(ok("/ws/e.kif"));
    fetchTree.mockResolvedValue(ok(dir("/ws", [kifu("/ws/e.kif")])));

    await act(async () => {
      screen.getByTestId("rename-again").click();
    });

    expect(shown("selected")).toBe("/ws/e.kif");
    expect(shown("active")).toBe("/ws/e.kif");
  });
});
