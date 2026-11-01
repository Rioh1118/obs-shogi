import { beforeEach, describe, expect, test, vi } from "vitest";
import type { KifuCreationOptions } from "@/entities/kifu/model/kifu";

/**
 * Rust のコマンド名と引数、`AsyncResult` への畳み方を、関数ごとに固定する。
 *
 * コマンド名と引数の欄は Rust の `#[command]` が受ける線の名前で、綴りが変わると
 * 型検査もコンパイルも通ったまま実行時に断られる。
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, invoke } satisfies typeof import("@tauri-apps/api/core");
});

const service = await import("../service");

const OPTIONS: KifuCreationOptions = {
  fileName: "a.kif",
  format: "kif",
  gameInfo: { black: "先手" },
  initialPosition: { preset: "HIRATE" },
};

const KIF = "手合割：平手\n手数----指手---------消費時間--\n   1 ７六歩(77)\n";

type Case = {
  name: string;
  run: () => Promise<unknown>;
  command: string;
  args: (received: Record<string, unknown>) => void;
  answer: unknown;
  data: unknown;
};

const CASES: Case[] = [
  {
    name: "readText",
    run: () => service.readText("/r/a.kif"),
    command: "read_file",
    args: (a) => expect(a).toEqual({ filePath: "/r/a.kif" }),
    answer: "本文",
    data: "本文",
  },
  {
    name: "createDir",
    run: () => service.createDir("/r", "d"),
    command: "create_directory",
    args: (a) => expect(a).toEqual({ parentDir: "/r", dirName: "d" }),
    answer: "/r/d",
    data: "/r/d",
  },
  {
    name: "createKifu",
    run: () => service.createKifu("/r", OPTIONS),
    command: "create_kifu_file",
    args: (a) => {
      expect(a).toMatchObject({ parentDir: "/r", fileName: "a.kif" });
      expect(a.jkfData).toMatchObject({ header: { 先手: "先手" }, moves: [{}] });
    },
    answer: "/r/a.kif",
    data: "/r/a.kif",
  },
  {
    name: "importKifu",
    run: () => service.importKifu("/r", "a.kif", KIF),
    command: "import_kifu_file",
    args: (a) => {
      expect(a).toMatchObject({ parentDir: "/r", fileName: "a.kif" });
      expect((a.jkfData as { moves: unknown[] }).moves).toHaveLength(2);
    },
    answer: "/r/a.kif",
    data: "/r/a.kif",
  },
  {
    name: "renameFile",
    run: () => service.renameFile("/r/a.kif", "b.kif"),
    command: "rename_kifu_file",
    args: (a) => expect(a).toEqual({ filePath: "/r/a.kif", newFileName: "b.kif" }),
    answer: "/r/b.kif",
    data: "/r/b.kif",
  },
  {
    name: "moveFile",
    run: () => service.moveFile("/r/a.kif", "/r/d", "b.kif"),
    command: "mv_kifu_file",
    args: (a) => expect(a).toEqual({ filePath: "/r/a.kif", destDir: "/r/d", newFileName: "b.kif" }),
    answer: "/r/d/b.kif",
    data: "/r/d/b.kif",
  },
  {
    name: "renameDir",
    run: () => service.renameDir("/r/d", "e"),
    command: "rename_directory",
    args: (a) => expect(a).toEqual({ dirPath: "/r/d", newDirName: "e" }),
    answer: "/r/e",
    data: "/r/e",
  },
  {
    name: "moveDir",
    run: () => service.moveDir("/r/d", "/r/p", "e"),
    command: "mv_directory",
    args: (a) => expect(a).toEqual({ dirPath: "/r/d", destParentDir: "/r/p", newDirName: "e" }),
    answer: "/r/p/e",
    data: "/r/p/e",
  },
  // Rust の `()` は `null` で届く。`data` は `void` なので `undefined` に揃える
  {
    name: "removeFile",
    run: () => service.removeFile("/r/a.kif"),
    command: "delete_file",
    args: (a) => expect(a).toEqual({ filePath: "/r/a.kif" }),
    answer: null,
    data: undefined,
  },
  {
    name: "removeDir",
    run: () => service.removeDir("/r/d"),
    command: "delete_directory",
    args: (a) => expect(a).toEqual({ dirPath: "/r/d" }),
    answer: null,
    data: undefined,
  },
];

/** Tauri の reject 値のほかに、Rust を通らない例外と壊れた値も同じ `Err` へ畳む */
const REJECTIONS: [string, unknown, { code: string; message?: string; path?: string | null }][] = [
  [
    "Rust の FsError",
    { code: "not_found", message: "gone", path: "/r/x", existingPath: null },
    { code: "not_found", message: "gone", path: "/r/x" },
  ],
  ["知らない code", { code: "new_code", message: "m" }, { code: "unknown", message: "m" }],
  ["Error", new Error("落ちた"), { code: "unknown", message: "落ちた" }],
  ["文字列", "断り", { code: "unknown", message: "断り" }],
  ["null", null, { code: "unknown", message: "null" }],
  ["undefined", undefined, { code: "unknown", message: "undefined" }],
];

beforeEach(() => {
  invoke.mockReset();
});

describe.each(CASES)("$name", ({ run, command, args, answer, data }) => {
  test("コマンドを1回呼び、答えを Ok で返す", async () => {
    invoke.mockResolvedValue(answer);

    const result = await run();

    expect(result).toStrictEqual({ success: true, data });
    expect(invoke).toHaveBeenCalledTimes(1);
    const [sent, received] = invoke.mock.calls[0] as [string, Record<string, unknown>];
    expect(sent).toBe(command);
    args(received);
  });

  test.each(REJECTIONS)("%s の断りを Err へ畳む", async (_name, rejected, expected) => {
    invoke.mockRejectedValue(rejected);

    const result = await run();

    expect(result).toMatchObject({ success: false, error: expected });
  });
});

describe("fetchTree", () => {
  test("get_file_tree の答えを FileTreeNode へ写す", async () => {
    invoke.mockResolvedValue({ id: "1", name: "ws", path: "/r", isDir: true, children: [] });

    const result = await service.fetchTree("/r");

    expect(invoke).toHaveBeenCalledWith("get_file_tree", { rootDir: "/r" });
    expect(result).toMatchObject({
      success: true,
      data: { id: "1", path: "/r", isDirectory: true, children: [] },
    });
  });

  test.each(REJECTIONS)("%s の断りを Err へ畳む", async (_name, rejected, expected) => {
    invoke.mockRejectedValue(rejected);

    expect(await service.fetchTree("/r")).toMatchObject({ success: false, error: expected });
  });

  test("答えが null でも投げない", async () => {
    invoke.mockResolvedValue(null);

    expect(await service.fetchTree("/r")).toMatchObject({
      success: false,
      error: { code: "unknown" },
    });
  });
});

describe("importKifu の手前の失敗", () => {
  test("読めない本文は Rust へ送らずに Err で返す", async () => {
    const result = await service.importKifu("/r", "a.kif", "");

    expect(result).toMatchObject({ success: false, error: { code: "unknown" } });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("createKifu の手前の失敗", () => {
  test("欄を欠いた指定でも投げずに Err で返す", async () => {
    const result = await service.createKifu("/r", {} as KifuCreationOptions);

    expect(result).toMatchObject({ success: false, error: { code: "unknown" } });
    expect(invoke).not.toHaveBeenCalled();
  });
});
