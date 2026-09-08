import { describe, expect, test, vi } from "vitest";

/**
 * **読めなかった棋譜のパスは必ず載る。**
 *
 * `io::Error` 由来の失敗（権限が無い、ボリュームが外れた）は Rust 側で `path` を
 * 積まない。読み手は `path` でどの棋譜かを判定するので、空のまま返すと
 * 「どれが読めなかったか」が決められない——`usePositionHitNavigation` は
 * これで移動の要求を捨てるかを決めている。
 */

const readFile = vi.fn();
vi.mock("../fileSystem", () => ({ readFile: (...a: unknown[]) => readFile(...a) }));

const { readKifu } = await import("../service");

const NODE = { path: "/root/a.kif", isDirectory: false } as never;

describe("readKifu", () => {
  test("path を持たない失敗にも、読もうとした棋譜のパスを載せる", async () => {
    readFile.mockRejectedValue({ code: "io", message: "permission denied" });

    const result = await readKifu(NODE);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.path).toBe("/root/a.kif");
  });

  test("Rust が積んだ path は上書きしない", async () => {
    readFile.mockRejectedValue({ code: "not_found", message: "gone", path: "/root/moved.kif" });

    const result = await readKifu(NODE);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.path).toBe("/root/moved.kif");
  });
});
