// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsError } from "@/entities/file-tree/api/error";
import type { KifuCreationOptions } from "@/entities/kifu/model/kifu";
import type { Result } from "@/shared/lib/result";
import type { FileTreeContextType, FileTreeNode } from "../types";

/**
 * 操作の失敗の行き先と、衝突の対話の解決を実物の provider で固定する。
 * 行き先の表は `docs/state-transitions/file-tree.md` の ※2。
 *
 * 行き先を間違えると、失敗が画面のどこにも出ないか、同じ失敗が2か所に出る。
 */

const api = vi.hoisted(() => ({
  fetchTree: vi.fn(),
  readKifu: vi.fn(),
  readText: vi.fn(),
  createKifu: vi.fn(),
  importKifu: vi.fn(),
  createDir: vi.fn(),
  removeFile: vi.fn(),
  removeDir: vi.fn(),
  renameFile: vi.fn(),
  moveFile: vi.fn(),
  renameDir: vi.fn(),
  moveDir: vi.fn(),
}));
const setRootDir = vi.hoisted(() => vi.fn());
const parseKifuContentToJKF = vi.hoisted(() => vi.fn());

vi.mock("../../api/service", () => api satisfies typeof import("../../api/service"));

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  return {
    ...actual,
    useAppConfig: () => ({ setRootDir }) as never,
  } satisfies typeof import("@/entities/app-config");
});

vi.mock("@/entities/kifu/api/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/kifu/api/parse")>();
  return { ...actual, parseKifuContentToJKF } satisfies typeof import("@/entities/kifu/api/parse");
});

const { FileTreeProvider } = await import("../provider");
const { useFileTree } = await import("../useFileTree");

const file = (path: string) =>
  ({
    id: path,
    name: path,
    path,
    isDirectory: false,
    displayInfo: { iconType: "kif-file" },
    kifuInfo: { format: "kif" },
  }) as FileTreeNode;
const folder = (path: string, children: FileTreeNode[] = []) =>
  ({
    id: path,
    name: path,
    path,
    isDirectory: true,
    displayInfo: { iconType: "folder" },
    children,
  }) as FileTreeNode;

const FILE = file("/ws/a.kif");
const DIR = folder("/ws/d");
const ROOT = folder("/ws", [FILE, DIR]);
const OPTIONS: KifuCreationOptions = {
  fileName: "a.kif",
  format: "kif",
  gameInfo: {},
  initialPosition: { preset: "HIRATE" },
};

const ok = <T,>(data: T) => ({ success: true, data });
const err = (code: FsError["code"], message = "x") => ({
  success: false,
  error: { code, message },
});

let tree: FileTreeContextType;

function Probe() {
  tree = useFileTree();
  return null;
}

async function mount() {
  render(
    <FileTreeProvider rootDir="/ws">
      <Probe />
    </FileTreeProvider>,
  );
  await act(async () => {});
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  await act(async () => {
    result = await operation();
  });
  return result as T;
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  setRootDir.mockReset();
  parseKifuContentToJKF.mockReset();
  api.fetchTree.mockResolvedValue(ok(ROOT));
});

afterEach(cleanup);

describe("失敗の行き先", () => {
  it("移動の失敗は通知へ積む", async () => {
    await mount();
    api.moveFile.mockResolvedValue(err("permission_denied"));

    const result = await run(() => tree.moveNode(FILE, "/ws/d"));

    expect(result.success).toBe(false);
    expect(tree.error).toMatchObject({ from: "operation", error: { code: "permission_denied" } });
  });

  it("作成の失敗は呼び手へ返し、通知へ積まない", async () => {
    await mount();
    api.createKifu.mockResolvedValue(err("permission_denied"));

    const result = await run(() => tree.createNewFile("/ws", OPTIONS));

    expect(result).toMatchObject({ success: false, error: { code: "permission_denied" } });
    expect(tree.error).toBeNull();
    expect(tree.conflict).toBeNull();
  });

  it("改名の名前の失敗は入力欄へ返し、通知へ積まない", async () => {
    await mount();
    api.renameFile.mockResolvedValue(err("extension_changed"));

    const result = await run(() => tree.renameNode(FILE, "a.csa"));

    expect(result).toMatchObject({ success: false, error: { code: "extension_changed" } });
    expect(tree.error).toBeNull();
  });

  it("改名の名前以外の失敗は通知へ積む", async () => {
    await mount();
    api.renameFile.mockResolvedValue(err("permission_denied"));

    await run(() => tree.renameNode(FILE, "b.kif"));

    expect(tree.error?.error.code).toBe("permission_denied");
  });

  it("削除の失敗は通知へ積む", async () => {
    await mount();
    api.removeFile.mockResolvedValue(err("io"));

    const result = await run(() => tree.deleteNode(FILE));

    expect(result.success).toBe(false);
    expect(tree.error?.error.code).toBe("io");
  });

  it("読み直しの失敗は操作の Err にせず、reload として積む", async () => {
    await mount();
    api.createKifu.mockResolvedValue(ok("/ws/new.kif"));
    api.fetchTree.mockResolvedValue(err("io"));

    const result = await run(() => tree.createNewFile("/ws", OPTIONS));

    expect(result).toEqual(ok("/ws/new.kif"));
    expect(tree.error).toMatchObject({ from: "reload", error: { code: "io" } });
  });

  it("読めない棋譜の失敗は kifuError へ積み、path を保つ", async () => {
    await mount();
    api.readKifu.mockResolvedValue({
      success: false,
      error: { code: "not_found", message: "x", path: "/ws/a.kif" },
    });

    const result = await run(() => tree.openKifuNode(FILE));

    expect(result.success).toBe(false);
    expect(tree.kifuError).toMatchObject({ code: "not_found", path: "/ws/a.kif" });
    expect(tree.error).toBeNull();
  });

  it("解析できない棋譜は kifu_parse_failed にして原因を残す", async () => {
    await mount();
    api.readKifu.mockResolvedValue(ok("壊れた本文"));
    parseKifuContentToJKF.mockImplementation(() => {
      throw Object.assign(new Error("読めない"), { cause: new Error("3手目") });
    });

    const result = await run(() => tree.openKifuNode(FILE));

    expect(result.success).toBe(false);
    expect(tree.kifuError).toEqual({
      code: "kifu_parse_failed",
      message: "failed to parse kifu content",
      path: FILE.path,
      cause: "読めない\n原因: 3手目",
    });
  });

  it("Error でない例外も文字列にして原因へ残す", async () => {
    await mount();
    api.readKifu.mockResolvedValue(ok("壊れた本文"));
    parseKifuContentToJKF.mockImplementation(() => {
      throw "断り";
    });

    await run(() => tree.openKifuNode(FILE));

    expect(tree.kifuError?.cause).toBe("断り");
  });

  it("形式の無いファイルは読みに行かず kifu_format_unknown を積む", async () => {
    await mount();
    const node = { ...FILE, kifuInfo: undefined };

    const result = await run(() => tree.openKifuNode(node));

    expect(result.success).toBe(false);
    expect(tree.kifuError).toMatchObject({ code: "kifu_format_unknown", path: FILE.path });
    expect(api.readKifu).not.toHaveBeenCalled();
  });
});

describe("ルートの改名", () => {
  it("設定の書き戻しが落ちたら config_write_failed を積み、衝突の対話を閉じる", async () => {
    await mount();
    api.renameDir.mockResolvedValueOnce(err("already_exists"));
    await run(() => tree.renameNode(ROOT, "x"));
    expect(tree.conflict).not.toBeNull();

    api.renameDir.mockResolvedValue(ok("/ws2"));
    setRootDir.mockResolvedValue({ success: false, error: "書けない" });
    const result = await run(() => tree.resolveConflictByRename("ws2"));

    expect(result).toMatchObject({ success: false, error: { code: "config_write_failed" } });
    expect(tree.conflict).toBeNull();
    expect(tree.error?.error).toMatchObject({ code: "config_write_failed", path: "/ws2" });
  });

  it("成功したら読み直しを起こさず setRootDir へ渡す", async () => {
    await mount();
    api.renameDir.mockResolvedValue(ok("/ws2"));
    setRootDir.mockResolvedValue({ success: true, data: undefined });
    const calls = api.fetchTree.mock.calls.length;

    const result = await run(() => tree.renameNode(ROOT, "ws2"));

    expect(result).toEqual(ok(undefined));
    expect(setRootDir).toHaveBeenCalledWith("/ws2");
    expect(api.fetchTree.mock.calls.length).toBe(calls);
  });
});

type ConflictCase = {
  name: string;
  open: () => Promise<Result<unknown, FsError>>;
  mock: (typeof api)[keyof typeof api];
  args: unknown[];
};

const CONFLICTS: ConflictCase[] = [
  {
    name: "棋譜の作成",
    open: () => tree.createNewFile("/ws", OPTIONS),
    mock: api.createKifu,
    args: ["/ws", { ...OPTIONS, fileName: "別名" }],
  },
  {
    name: "棋譜の取り込み",
    open: () => tree.importKifuFile("/ws", "a.kif", "  本文  "),
    mock: api.importKifu,
    args: ["/ws", "別名", "本文"],
  },
  {
    name: "フォルダの作成",
    open: () => tree.createNewDirectory("/ws", "d"),
    mock: api.createDir,
    args: ["/ws", "別名"],
  },
  {
    name: "ファイルの改名",
    open: () => tree.renameNode(FILE, "b.kif"),
    mock: api.renameFile,
    args: ["/ws/a.kif", "別名"],
  },
  {
    name: "フォルダの改名",
    open: () => tree.renameNode(DIR, "e"),
    mock: api.renameDir,
    args: ["/ws/d", "別名"],
  },
  {
    name: "ファイルの移動",
    open: () => tree.moveNode(FILE, "/ws/d"),
    mock: api.moveFile,
    args: ["/ws/a.kif", "/ws/d", "別名"],
  },
  {
    name: "フォルダの移動",
    open: () => tree.moveNode(DIR, "/ws/p", "d"),
    mock: api.moveDir,
    args: ["/ws/d", "/ws/p", "別名"],
  },
];

describe.each(CONFLICTS)("衝突の解決: $name", ({ open, mock, args }) => {
  async function openConflict() {
    await mount();
    mock.mockResolvedValueOnce(err("already_exists"));
    await run(open);
    expect(tree.conflict?.error.code).toBe("already_exists");
    expect(tree.error).toBeNull();
    mock.mockClear();
  }

  it("通ったら対話を閉じ、Ok の data は空にする", async () => {
    await openConflict();
    mock.mockResolvedValue(ok("/ws/別名"));

    const result = await run(() => tree.resolveConflictByRename("  別名  "));

    expect(mock).toHaveBeenCalledWith(...args);
    expect(result).toEqual(ok(undefined));
    expect(tree.conflict).toBeNull();
  });

  it("名前の衝突がまた起きたら対話を開いたまま Err を返す", async () => {
    await openConflict();
    mock.mockResolvedValue(err("already_exists"));

    const result = await run(() => tree.resolveConflictByRename("別名"));

    expect(result.success).toBe(false);
    expect(tree.conflict).not.toBeNull();
  });

  it("空の名前は送らずに invalid_name_empty を返し、対話は開いたまま", async () => {
    await openConflict();

    const result = await run(() => tree.resolveConflictByRename("   "));

    expect(result).toMatchObject({ success: false, error: { code: "invalid_name_empty" } });
    expect(mock).not.toHaveBeenCalled();
    expect(tree.conflict).not.toBeNull();
    expect(tree.error).toBeNull();
  });
});

describe("衝突の対象が消えたとき", () => {
  it.each([
    ["改名", () => tree.renameNode(file("/ws/消えた.kif"), "b.kif"), api.renameFile],
    ["移動", () => tree.moveNode(file("/ws/消えた.kif"), "/ws/d"), api.moveFile],
  ] as const)("%s の対話を閉じて not_found を通知へ積む", async (_name, open, mock) => {
    await mount();
    mock.mockResolvedValueOnce(err("already_exists"));
    await run(open);

    const result = await run(() => tree.resolveConflictByRename("別名"));

    expect(result).toMatchObject({ success: false, error: { code: "not_found" } });
    expect(tree.conflict).toBeNull();
    expect(tree.error?.error).toMatchObject({ code: "not_found", path: "/ws/消えた.kif" });
  });
});

describe("衝突が無いとき", () => {
  it("resolveConflictByRename は何もせず Ok を返す", async () => {
    await mount();

    expect(await run(() => tree.resolveConflictByRename("x"))).toEqual(ok(undefined));
  });
});
