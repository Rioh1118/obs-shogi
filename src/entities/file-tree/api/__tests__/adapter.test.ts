import { describe, expect, test, vi } from "vitest";

/**
 * Rust の `FileTreeNode` から TS の節への写し。
 *
 * 欄が揃っているかは `src/__tests__/fileTreeWire.test.ts` が見ている。
 * ここは値の変換を固定する。棋譜の形式が取れないと、その行は開けずに
 * `kifu_format_unknown` で断られる。
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, invoke } satisfies typeof import("@tauri-apps/api/core");
});

const { getFileTree } = await import("../fileSystem");

const FILE = { id: "f", name: "a.kif", path: "/r/a.kif", isDir: false };

async function nodeOf(wire: Record<string, unknown>) {
  invoke.mockResolvedValue(wire);
  return await getFileTree("/r");
}

describe("棋譜の形式", () => {
  test.each(["kif", "ki2", "jkf", "csa"])("%s を形式として読む", async (extension) => {
    expect((await nodeOf({ ...FILE, extension })).kifuInfo).toEqual({ format: extension });
  });

  test("大文字の拡張子も読む", async () => {
    expect((await nodeOf({ ...FILE, extension: "KIF" })).kifuInfo).toEqual({ format: "kif" });
  });

  test.each([undefined, "", "txt"])("拡張子が %j のファイルは形式を持たない", async (extension) => {
    expect((await nodeOf({ ...FILE, extension })).kifuInfo).toBeUndefined();
  });

  test("フォルダは拡張子があっても形式を持たない", async () => {
    const node = await nodeOf({ ...FILE, isDir: true, extension: "kif" });

    expect(node.kifuInfo).toBeUndefined();
  });
});

describe("欄の写し", () => {
  test("更新時刻は unix 秒から Date へ直す", async () => {
    const node = await nodeOf({ ...FILE, lastModified: 1700000000 });

    expect(node.lastModified).toEqual(new Date(1700000000 * 1000));
  });

  test("更新時刻の 0 を欠けと読まない", async () => {
    expect((await nodeOf({ ...FILE, lastModified: 0 })).lastModified).toEqual(new Date(0));
  });

  test("更新時刻が欠けたら欄も欠ける", async () => {
    expect((await nodeOf(FILE)).lastModified).toBeUndefined();
  });

  test("行のアイコンはフォルダかどうかで決まる", async () => {
    expect((await nodeOf(FILE)).displayInfo.iconType).toBe("kif-file");
    expect((await nodeOf({ ...FILE, isDir: true })).displayInfo.iconType).toBe("folder");
  });

  test("子も同じ規則で写す", async () => {
    const root = await nodeOf({
      id: "r",
      name: "ws",
      path: "/r",
      isDir: true,
      truncated: true,
      children: [{ ...FILE, extension: "csa", size: 12 }],
    });

    expect(root.truncated).toBe(true);
    expect(root.children).toHaveLength(1);
    expect(root.children?.[0]).toMatchObject({
      isDirectory: false,
      size: 12,
      kifuInfo: { format: "csa" },
    });
  });
});
