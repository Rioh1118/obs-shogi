// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **選択されているファイルと、盤に載っている棋譜は同じものである。**
 *
 * 選択は同期で動くのに、盤は `api.readKifu` の IPC を跨いだ読み出しが返ってから決まる。
 * 解決の順は棋譜の大きさで前後するので、要求した順に載るとは限らない。→ #223
 *
 * ずれても画面には何も出ない。`FileNode` は盤に載っているかを強調に使っておらず、
 * 手掛かりは選択の強調とヘッダのファイル名（`useHeaderCenterInfo`）だけで、
 * どちらも**選択**を見ている。利用者は名前を見ているのとは別のファイルを編集し、
 * `GamePersistenceGate` は `activeKifuPath` へ書く。
 *
 * どの検査も `active` と `selected` を**対で**見ること。片方だけではずれを検出できない。
 */

const fetchTree = vi.fn();
const readKifu = vi.fn();
const parseKifu = vi.fn();
const removeFile = vi.fn();

vi.mock("../../api/service", () => ({
  fetchTree: (...a: unknown[]) => fetchTree(...a),
  readKifu: (...a: unknown[]) => readKifu(...a),
  readText: vi.fn(),
  createKifu: vi.fn(),
  importKifu: vi.fn(),
  createDir: vi.fn(),
  removeFile: (...a: unknown[]) => removeFile(...a),
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
  parseKifuContentToJKF: (...a: unknown[]) => parseKifu(...a),
}));

const { FileTreeProvider } = await import("../provider");
const { useFileTree } = await import("../useFileTree");

const A_KIFU = "/ws/a.kif";
const B_KIFU = "/ws/b.kif";
const C_KIFU = "/ws/c.kif";

const A_NODE = {
  id: "a",
  name: "a.kif",
  path: A_KIFU,
  isDirectory: false,
  displayInfo: { iconType: "kif-file" as const },
  kifuInfo: { format: "kif" as const },
};

const B_NODE = { ...A_NODE, id: "b", name: "b.kif", path: B_KIFU };
const C_NODE = { ...A_NODE, id: "c", name: "c.kif", path: C_KIFU };

const TREE = {
  id: "root",
  name: "ws",
  path: "/ws",
  isDirectory: true,
  displayInfo: { iconType: "folder" as const },
  children: [A_NODE, B_NODE, C_NODE],
};

/**
 * `FileNode.handleClick` を写す。**`isActive` の関門も含めて写すこと。**
 *
 * 現物は盤に載っている棋譜をクリックしても `openKifuNode` を呼ばない。関門を落とすと、
 * 「読み込み中に元の棋譜へ戻る」経路（下の検査）がこの Probe では再現しなくなる。
 */
function Probe() {
  const { activeKifuPath, selectedNode, kifuError, selectNode, openKifuNode, deleteNode } =
    useFileTree();
  const click = (node: typeof A_NODE) => () => {
    const isActive = activeKifuPath === node.path;
    selectNode(node as never);
    if (!isActive) {
      void openKifuNode(node as never); // async-result-ignored: FileNode と同じく投げっぱなしにする
    }
  };
  return (
    <div>
      <span data-testid="active">{activeKifuPath ?? "-"}</span>
      <span data-testid="selected">{selectedNode?.path ?? "-"}</span>
      <span data-testid="kifu-error">{kifuError?.code ?? "-"}</span>
      <button data-testid="open-a" onClick={click(A_NODE)}>
        a
      </button>
      <button data-testid="open-b" onClick={click(B_NODE)}>
        b
      </button>
      <button data-testid="open-c" onClick={click(C_NODE)}>
        c
      </button>
      <button
        data-testid="delete-b"
        onClick={() => void deleteNode(B_NODE as never)} // async-result-ignored: 失敗は deleteNode が積む
      >
        delete b
      </button>
    </div>
  );
}

/** 解決の順をテストが決められるように、パスごとに読み出しを保留する */
function deferReadKifu() {
  const pending = new Map<string, (result: unknown) => void>();
  readKifu.mockImplementation(
    (node: { path: string }) =>
      new Promise((resolve) => {
        pending.set(node.path, resolve as (result: unknown) => void);
      }),
  );
  return async (path: string, result: unknown) => {
    await act(async () => {
      pending.get(path)!(result);
      await Promise.resolve();
    });
  };
}

const ok = (content: string) => ({ success: true, data: content });
const denied = (path: string) => ({
  success: false,
  error: { code: "permission_denied", message: "denied", path },
});

async function renderTree() {
  render(
    <FileTreeProvider rootDir="/ws">
      <Probe />
    </FileTreeProvider>,
  );
  await act(async () => {});
}

const click = async (testId: string) => {
  await act(async () => {
    screen.getByTestId(testId).click();
  });
};

const shows = (testId: string) => screen.getByTestId(testId).textContent;

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  fetchTree.mockResolvedValue({ success: true, data: TREE });
  parseKifu.mockImplementation((content: string) => ({ header: { source: content }, moves: [] }));
});

describe("続けて棋譜を開いたとき", () => {
  it("先にクリックした棋譜が後から返っても、盤は最後に選んだ棋譜のまま", async () => {
    const resolveRead = deferReadKifu();
    await renderTree();

    await click("open-a");
    await click("open-b");

    // B（小さい）が先に返り、A（大きい）が後から返る
    await resolveRead(B_KIFU, ok("b"));
    expect(shows("active")).toBe(B_KIFU);

    await resolveRead(A_KIFU, ok("a"));

    expect(shows("active")).toBe(B_KIFU);
    expect(shows("selected")).toBe(B_KIFU);
  });

  it("先にクリックした棋譜の失敗は、後から返っても断りに出さない", async () => {
    // 出すと、盤に載っている B は正常なのに「開けません」だけが残る
    const resolveRead = deferReadKifu();
    await renderTree();

    await click("open-a");
    await click("open-b");

    await resolveRead(B_KIFU, ok("b"));
    await resolveRead(A_KIFU, denied(A_KIFU));

    expect(shows("active")).toBe(B_KIFU);
    expect(shows("selected")).toBe(B_KIFU);
    expect(shows("kifu-error")).toBe("-");
  });

  it("先にクリックした棋譜のパース失敗も、後から返ったなら断りに出さない", async () => {
    // 読み取りの失敗と別の枝（catch）を通る。関門が try の前にあることを固定する
    const resolveRead = deferReadKifu();
    parseKifu.mockImplementation((content: string) => {
      if (content === "a") throw new Error("壊れている");
      return { header: { source: content }, moves: [] };
    });
    await renderTree();

    await click("open-a");
    await click("open-b");

    await resolveRead(B_KIFU, ok("b"));
    await resolveRead(A_KIFU, ok("a"));

    expect(shows("active")).toBe(B_KIFU);
    expect(shows("kifu-error")).toBe("-");
  });

  it("後から始めた読み出しが先に始めたものより遅く返っても、盤はそれを載せる", async () => {
    // 捨てるのは**宛先と違う**要求だけ。順に返っただけの新しい要求まで捨てると、
    // 大きい棋譜を後からクリックしたときに盤が更新されなくなる
    const resolveRead = deferReadKifu();
    await renderTree();

    await click("open-a");
    await click("open-b");

    await resolveRead(A_KIFU, ok("a"));
    await resolveRead(B_KIFU, ok("b"));

    expect(shows("active")).toBe(B_KIFU);
    expect(shows("selected")).toBe(B_KIFU);
  });

  it("捨てた要求の失敗は、新しい要求が返るまでの間も断りに出さない", async () => {
    // 古い方が先に、しかも失敗して返る窓。ここで断りを出すと、
    // 利用者が選び直した B の読み込み中に A の「開けません」が割り込む
    const resolveRead = deferReadKifu();
    await renderTree();

    await click("open-a");
    await click("open-b");

    await resolveRead(A_KIFU, denied(A_KIFU));
    expect(shows("kifu-error")).toBe("-");
    expect(shows("active")).toBe("-");

    await resolveRead(B_KIFU, ok("b"));

    expect(shows("active")).toBe(B_KIFU);
    expect(shows("selected")).toBe(B_KIFU);
  });

  it("読み込み中に盤に載っている棋譜へ戻ると、飛行中の読み出しは載らない", async () => {
    // `FileNode` は載っている棋譜では `openKifuNode` を呼ばない。捨てる基準を
    // 「`openKifuNode` に入った回数」に置くと、この経路だけ無効化されずに残る
    const resolveRead = deferReadKifu();
    await renderTree();

    await click("open-a");
    await resolveRead(A_KIFU, ok("a"));
    expect(shows("active")).toBe(A_KIFU);

    await click("open-b");
    await click("open-a"); // 気が変わって戻る。`isActive` なので読み出しは起きない

    await resolveRead(B_KIFU, ok("b"));

    expect(shows("active")).toBe(A_KIFU);
    expect(shows("selected")).toBe(A_KIFU);
  });

  it("読み込み中に消したファイルは、読み出しが返っても盤に載らない", async () => {
    // 載せると `activeKifuPath` が消したファイルへ変わる。ツリーの読み直しが失敗した回は
    // それが残り、1手指すと `GamePersistenceGate` が**消したはずのファイルを書き戻す**
    const resolveRead = deferReadKifu();
    removeFile.mockResolvedValue({ success: true, data: undefined });
    await renderTree();

    await click("open-a");
    await resolveRead(A_KIFU, ok("a"));

    await click("open-b");
    await click("delete-b");

    await resolveRead(B_KIFU, ok("b"));

    expect(shows("active")).toBe(A_KIFU);
    expect(shows("selected")).toBe("-");
  });

  it("新しい要求が失敗したら、選択は盤に載っている棋譜へ戻る", async () => {
    // 戻す先を「1つ前の選択」にすると、それ自体が捨てられた要求の対象でありうる。
    // ここでは A で、A の成功は宛先が C に戻ったあとなので載らない。
    // 選択だけ A に戻すと、盤には C が載っているのにヘッダは「a」と名乗る
    const resolveRead = deferReadKifu();
    await renderTree();

    await click("open-c");
    await resolveRead(C_KIFU, ok("c"));

    await click("open-a");
    await click("open-b");

    await resolveRead(B_KIFU, denied(B_KIFU));
    expect(shows("selected")).toBe(C_KIFU);
    expect(shows("kifu-error")).toBe("permission_denied");

    await resolveRead(A_KIFU, ok("a"));

    expect(shows("active")).toBe(C_KIFU);
    expect(shows("selected")).toBe(C_KIFU);
  });
});
