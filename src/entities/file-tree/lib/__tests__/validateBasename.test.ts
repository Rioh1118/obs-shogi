import { describe, expect, test } from "vitest";
import { validateBasename } from "../validateBasename";

/**
 * 失敗は `FsError` として返す。Rust から返る失敗と同じ経路で表示するため、
 * ここだけ別の形にすると表示側が2通りの分岐を持つことになる。
 */

describe("validateBasename", () => {
  test("前後の空白は落とす", () => {
    const res = validateBasename("  a.kif  ");

    expect(res.success && res.data).toBe("a.kif");
  });

  test("空の名前は通さない", () => {
    const res = validateBasename("   ");

    expect(res.success).toBe(false);
  });

  test("区切り文字は通さない", () => {
    for (const name of ["a/b", "a\\b", "/a", "a\\"]) {
      expect(validateBasename(name).success, name).toBe(false);
    }
  });

  // 何が悪いかは code では伝わらない。空とパス区切りが同じ code に落ちるので、
  // 直し方を持っているのは message だけになる
  test("何を直せばよいかを message に持つ", () => {
    const empty = validateBasename("");
    const separator = validateBasename("a/b");

    expect(empty.success).toBe(false);
    expect(separator.success).toBe(false);
    if (empty.success || separator.success) return;

    expect(empty.error.message).not.toBe(separator.error.message);
    expect(separator.error.message).toContain("/");
  });

  test("失敗は FsError の形で返す", () => {
    const res = validateBasename("a/b");

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe("invalid_name");
  });
});
