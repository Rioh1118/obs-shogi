// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * アプリの外の変更を受けてツリーを取り直す（#766）。
 *
 * 取り直しは利用者の操作に続かずに起きる。操作の途中・失敗の通知・行の改名中に
 * 割り込んでも、そちらを壊さないことを固定する。
 */

const fetchTree = vi.fn();
const renameFile = vi.fn();
const renameDir = vi.fn();
const readKifu = vi.fn();

vi.mock("../../api/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/service")>();
  const mocked = {
    ...actual,
    fetchTree: ((...a: unknown[]) => fetchTree(...a)) as typeof actual.fetchTree,
    renameFile: ((...a: unknown[]) => renameFile(...a)) as typeof actual.renameFile,
    renameDir: ((...a: unknown[]) => renameDir(...a)) as typeof actual.renameDir,
    readKifu: ((...a: unknown[]) => readKifu(...a)) as typeof actual.readKifu,
  };
  return mocked satisfies typeof import("../../api/service");
});

/** 監視の合図とフォーカスの両方がここへ来る。テストから撃つ */
let notifyChange: () => void = () => {};
vi.mock("../../api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/events")>();
  const mocked = {
    ...actual,
    listenWorkspaceChanges: (onChange: () => void) => {
      notifyChange = onChange;
      return Promise.resolve(() => {});
    },
  };
  return mocked satisfies typeof import("../../api/events");
});

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => ({
      setRootDir: vi.fn().mockResolvedValue({ success: true }),
    })) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});

vi.mock("@/entities/kifu/api/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/kifu/api/parse")>();
  const mocked = {
    ...actual,
    parseKifuContentToJKF: (() => ({
      header: {},
      moves: [],
    })) as unknown as typeof actual.parseKifuContentToJKF,
  };
  return mocked satisfies typeof import("@/entities/kifu/api/parse");
});

const { FileTreeProvider } = await import("../provider");
const { useFileTree } = await import("../useFileTree");

type Node = {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children?: Node[];
  kifuInfo?: { format: "kif" };
  lastModified?: Date;
};

const kifu = (id: string, path: string, extra: Partial<Node> = {}): Node => ({
  id,
  name: path.split("/").pop()!,
  path,
  isDirectory: false,
  kifuInfo: { format: "kif" },
  ...extra,
});

/** `id` は走査のたびに振り直されるので、取るたびに変える */
let scan = 0;
function tree(...files: string[]): Node {
  scan += 1;
  return {
    id: `root-${scan}`,
    name: "ws",
    path: "/ws",
    isDirectory: true,
    children: [
      {
        id: `dir-${scan}`,
        name: "D",
        path: "/ws/D",
        isDirectory: true,
        children: files.map((p) => kifu(`${p}-${scan}`, p)),
      },
    ],
  };
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok = <T,>(data: T) => ({ success: true as const, data });

let renders = 0;

function Probe() {
  const ctx = useFileTree();
  renders += 1;
  const paths: string[] = [];
  const walk = (n: Node) => {
    paths.push(n.path);
    n.children?.forEach(walk);
  };
  if (ctx.fileTree) walk(ctx.fileTree as Node);
  const find = (p: string) => {
    let hit: Node | null = null;
    const go = (n: Node) => {
      if (n.path === p) hit = n;
      n.children?.forEach(go);
    };
    if (ctx.fileTree) go(ctx.fileTree as Node);
    return hit as never;
  };
  const renaming = paths.find((p) => find(p) && (find(p) as Node).id === ctx.renamingNodeId);
  return (
    <div>
      <span data-testid="paths">{paths.join(",")}</span>
      <span data-testid="active">{ctx.activeKifuPath ?? "-"}</span>
      <span data-testid="selected">{ctx.selectedNode?.path ?? "-"}</span>
      <span data-testid="expanded">{[...ctx.expandedNodes].join(",")}</span>
      <span data-testid="error">
        {ctx.error ? `${ctx.error.from}:${ctx.error.error.code}` : "-"}
      </span>
      <span data-testid="loading">{String(ctx.isLoading)}</span>
      <span data-testid="renaming">{renaming ?? "-"}</span>
      <button
        data-testid="open-a"
        onClick={() => void ctx.selectNodeByAbsPath("/ws/D/a.kif", { forceReopen: true })}
      />
      <button data-testid="expand-d" onClick={() => ctx.toggleNode("/ws/D")} />
      <button
        data-testid="start-rename-a"
        onClick={() => ctx.startInlineRename(find("/ws/D/a.kif"))}
      />
      <button
        data-testid="rename-a"
        onClick={() => void ctx.renameNode(find("/ws/D/a.kif"), "z.kif")}
      />
      <button data-testid="menu-a" onClick={() => ctx.openContextMenu(find("/ws/D/a.kif"), 0, 0)} />
      <button
        data-testid="rename-from-menu"
        onClick={() => ctx.menu && ctx.startInlineRename(ctx.menu.node)}
      />
      <button data-testid="select-a" onClick={() => ctx.selectNode(find("/ws/D/a.kif"))} />
      <button data-testid="rename-root" onClick={() => void ctx.renameNode(find("/ws"), "ws2")} />
      <button
        data-testid="push-error"
        onClick={() => ctx.pushError({ code: "permission_denied", message: "x" } as never)}
      />
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

async function mount(initial: Node) {
  fetchTree.mockResolvedValueOnce(ok(initial));
  render(
    <FileTreeProvider rootDir="/ws">
      <Probe />
    </FileTreeProvider>,
  );
  await act(async () => {});
}

async function notify(next: Node | ReturnType<typeof deferred>["promise"]) {
  fetchTree.mockReturnValueOnce(next instanceof Promise ? next : Promise.resolve(ok(next)));
  await act(async () => {
    notifyChange();
  });
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  renders = 0;
  readKifu.mockResolvedValue(ok(""));
});

describe("外の変更を受けた取り直し", () => {
  it("合図でツリーを取り直し、外で足した棋譜が出る", async () => {
    await mount(tree("/ws/D/a.kif"));
    await notify(tree("/ws/D/a.kif", "/ws/D/b.kif"));
    expect(text("paths")).toContain("/ws/D/b.kif");
  });

  it("選んだ棋譜・開いている棋譜・開いたフォルダを保つ", async () => {
    await mount(tree("/ws/D/a.kif"));
    await act(async () => {
      screen.getByTestId("expand-d").click();
      screen.getByTestId("open-a").click();
    });
    expect(text("active")).toBe("/ws/D/a.kif");

    await notify(tree("/ws/D/a.kif", "/ws/D/b.kif"));

    expect(text("selected")).toBe("/ws/D/a.kif");
    expect(text("active")).toBe("/ws/D/a.kif");
    expect(text("expanded")).toContain("/ws/D");
  });

  it("出ている失敗の通知を消さず、読み込み中にもしない", async () => {
    await mount(tree("/ws/D/a.kif"));
    await act(async () => {
      screen.getByTestId("push-error").click();
    });
    const pending = deferred<unknown>();
    await notify(pending.promise as never);
    expect(text("loading")).toBe("false");

    await act(async () => {
      pending.resolve(ok(tree("/ws/D/a.kif", "/ws/D/b.kif")));
    });
    expect(text("paths")).toContain("/ws/D/b.kif");
    expect(text("error")).toBe("operation:permission_denied");
  });

  it("取り直しが落ちたら一覧の失敗として出す。出ている通知は差し替えない", async () => {
    await mount(tree("/ws/D/a.kif"));
    fetchTree.mockResolvedValueOnce({ success: false, error: { code: "not_found", message: "x" } });
    await act(async () => {
      notifyChange();
    });
    expect(text("error")).toBe("reload:not_found");

    // 通知が出ているところへもう一度落ちても、前の通知のまま
    fetchTree.mockResolvedValueOnce({ success: false, error: { code: "io", message: "y" } });
    await act(async () => {
      notifyChange();
    });
    expect(text("error")).toBe("reload:not_found");
  });

  it("行の改名中に届いても、入力欄は同じ行に残る", async () => {
    await mount(tree("/ws/D/a.kif"));
    await act(async () => {
      screen.getByTestId("start-rename-a").click();
    });
    expect(text("renaming")).toBe("/ws/D/a.kif");

    await notify(tree("/ws/D/a.kif", "/ws/D/b.kif"));

    expect(text("renaming")).toBe("/ws/D/a.kif");
  });

  it("中身が同じなら描き直さない（外のエディタで棋譜を保存しても合図は来る）", async () => {
    await mount(tree("/ws/D/a.kif"));
    const before = renders;
    // `id` と更新時刻は変わる
    const same = tree("/ws/D/a.kif");
    same.children![0].children![0].lastModified = new Date();
    await notify(same);
    expect(renders).toBe(before);
  });

  it("取得中に何度きっかけが来ても、返ってから1回だけ取り直す", async () => {
    await mount(tree("/ws/D/a.kif"));
    const calls = fetchTree.mock.calls.length;
    const slow = deferred<unknown>();
    await notify(slow.promise as never);
    // 合図とフォーカスがほぼ同時に来る
    fetchTree.mockResolvedValueOnce(ok(tree("/ws/D/a.kif", "/ws/D/new.kif")));
    await act(async () => {
      notifyChange();
      notifyChange();
    });
    expect(fetchTree.mock.calls.length).toBe(calls + 1);

    await act(async () => {
      slow.resolve(ok(tree("/ws/D/a.kif")));
    });
    expect(fetchTree.mock.calls.length).toBe(calls + 2);
    expect(text("paths")).toContain("/ws/D/new.kif");
  });

  it("開いたままのメニューから、取り直しの後に改名できる", async () => {
    await mount(tree("/ws/D/a.kif"));
    await act(async () => {
      screen.getByTestId("menu-a").click();
    });
    await notify(tree("/ws/D/a.kif", "/ws/D/b.kif"));
    await act(async () => {
      screen.getByTestId("rename-from-menu").click();
    });
    expect(text("renaming")).toBe("/ws/D/a.kif");
  });

  /**
   * ルートの改名は読み直さず、`rootDir` の変化に任せる。操作が抜けてから読み直しが
   * 始まるまでに古い木が通ると、新しいパスへ張り替えた選択を古い木で引いて落とす。
   * 開いた棋譜で見ないのは、`rootDir` を変えないこのテストでは、根の外の棋譜を閉じる
   * 効果が先に閉じるから
   */
  it("ルートの改名の前に始まった取得が後から着いても、選択を落とさない", async () => {
    await mount(tree("/ws/D/a.kif"));
    await act(async () => {
      screen.getByTestId("select-a").click();
    });
    const slow = deferred<unknown>();
    await notify(slow.promise as never);

    renameDir.mockResolvedValueOnce(ok("/ws2"));
    await act(async () => {
      screen.getByTestId("rename-root").click();
    });

    // 改名の前に取った木。外で足した棋譜を含み、古いルートの下にある
    await act(async () => {
      slow.resolve(ok(tree("/ws/D/a.kif", "/ws/D/b.kif")));
    });
    expect(text("paths")).not.toContain("/ws/D/b.kif");
    expect(text("selected")).not.toBe("-");
  });

  /** 合図の取得を飛ばしたまま、開いている a.kif の改名を始める */
  async function renameWhileRefreshing() {
    await mount(tree("/ws/D/a.kif"));
    await act(async () => {
      screen.getByTestId("open-a").click();
    });
    const slow = deferred<unknown>();
    await notify(slow.promise as never);
    const rename = deferred<unknown>();
    renameFile.mockReturnValueOnce(rename.promise);
    await act(async () => {
      screen.getByTestId("rename-a").click();
    });
    return { slow, rename };
  }

  it("改名の API が返る前に着いた結果で、開いている棋譜を閉じない", async () => {
    const { slow, rename } = await renameWhileRefreshing();

    // ディスクではもう改名が済んでいて、取得はそれを見ている。盤はまだ古い名前を指す
    await act(async () => {
      slow.resolve(ok(tree("/ws/D/z.kif")));
    });
    expect(text("active")).toBe("/ws/D/a.kif");

    fetchTree.mockResolvedValueOnce(ok(tree("/ws/D/z.kif")));
    await act(async () => {
      rename.resolve(ok("/ws/D/z.kif"));
    });
    expect(text("active")).toBe("/ws/D/z.kif");
  });

  it("改名を終えた後に着いた古い結果で、開いている棋譜を閉じない", async () => {
    const { slow, rename } = await renameWhileRefreshing();

    fetchTree.mockResolvedValueOnce(ok(tree("/ws/D/z.kif")));
    await act(async () => {
      rename.resolve(ok("/ws/D/z.kif"));
    });
    expect(text("active")).toBe("/ws/D/z.kif");

    // 改名の前に取った木。古い名前しか無い
    await act(async () => {
      slow.resolve(ok(tree("/ws/D/a.kif")));
    });
    expect(text("active")).toBe("/ws/D/z.kif");
    expect(text("paths")).toContain("/ws/D/z.kif");
  });

  it("操作の途中に届いた合図では取りにいかない", async () => {
    await mount(tree("/ws/D/a.kif"));
    const rename = deferred<unknown>();
    renameFile.mockReturnValueOnce(rename.promise);
    await act(async () => {
      screen.getByTestId("rename-a").click();
    });
    const calls = fetchTree.mock.calls.length;
    await act(async () => {
      notifyChange();
    });
    expect(fetchTree.mock.calls.length).toBe(calls);

    fetchTree.mockResolvedValueOnce(ok(tree("/ws/D/z.kif")));
    await act(async () => {
      rename.resolve(ok("/ws/D/z.kif"));
    });
  });
});
