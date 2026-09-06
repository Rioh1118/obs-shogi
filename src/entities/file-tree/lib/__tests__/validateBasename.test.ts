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

  test("予約された名前は通さない", () => {
    for (const name of [".", "..", "  ..  "]) {
      expect(validateBasename(name).success, name).toBe(false);
    }
  });

  test("NUL は通さない", () => {
    expect(validateBasename("a\0b").success).toBe(false);
  });

  /**
   * 利用者に見せる文は code から引く。原因を1つの code に潰すと、
   * 「その名前は使えません」しか出せなくなって直しようがなくなる。
   *
   * 規則と code は Rust 側（`fs/path.rs`）と同じ4つ。片方だけ
   * 増やすと、ここを通ってから向こうで落ちる名前ができる
   */
  test("原因ごとに違う code を返す", () => {
    const codeOf = (name: string) => {
      const res = validateBasename(name);
      return res.success ? null : res.error.code;
    };

    expect(codeOf("")).toBe("invalid_name_empty");
    expect(codeOf("..")).toBe("invalid_name_reserved");
    expect(codeOf("a/b")).toBe("invalid_name_separator");
    expect(codeOf("a\0b")).toBe("invalid_name_control");
  });
});
