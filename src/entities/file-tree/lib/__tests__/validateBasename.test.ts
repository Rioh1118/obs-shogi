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

  // 利用者に見せる文は code から引く。原因を1つの code に潰すと、
  // 「その名前は使えません」しか出せなくなって直しようがなくなる
  test("原因ごとに違う code を返す", () => {
    const empty = validateBasename("");
    const separator = validateBasename("a/b");

    expect(empty.success).toBe(false);
    expect(separator.success).toBe(false);
    if (empty.success || separator.success) return;

    expect(empty.error.code).toBe("invalid_name_empty");
    expect(separator.error.code).toBe("invalid_name_separator");
  });
});
