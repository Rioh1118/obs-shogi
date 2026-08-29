import { describe, expect, test } from "vitest";
import {
  asFsError,
  describeFsError,
  fsErrorPresentation,
  makeFsError,
  type FsErrorCode,
} from "@/entities/file-tree/api/error";

/**
 * `service.ts` は `catch (e)` で受けたものを全部ここへ流す。Rust から返る `FsError`
 * だけでなく、棋譜のパース失敗のような別の例外も混ざる。
 */

const ALL_CODES: FsErrorCode[] = [
  "already_exists",
  "not_found",
  "invalid_name",
  "invalid_path",
  "invalid_type",
  "invalid_extension",
  "invalid_destination",
  "permission_denied",
  "io",
  "unknown",
];

describe("asFsError", () => {
  test("Rust から返った形はそのまま通す", () => {
    const src = makeFsError("io", "os error 5", "/root/a.kif");

    expect(asFsError(src)).toEqual(src);
  });

  // ここを素通しにすると code がどの分岐にも当たらず、見出しの無い箱が出る
  test("知らない code は unknown に落とす", () => {
    const res = asFsError({ code: "something_else", message: "?" });

    expect(res.code).toBe("unknown");
  });

  test("FsError ですらないものも受け取る", () => {
    expect(asFsError(new Error("パースできません")).code).toBe("unknown");
    expect(asFsError("文字列").code).toBe("unknown");
    expect(asFsError(null).code).toBe("unknown");
    expect(asFsError(undefined).code).toBe("unknown");
  });

  test("落とすときも元の内容は残す", () => {
    expect(asFsError(new Error("パースできません")).message).toContain("パースできません");
  });
});

describe("describeFsError", () => {
  // 見出しが空だと、何が起きたか分からない箱だけが出る
  test("どの code でも一文を返す", () => {
    for (const code of ALL_CODES) {
      expect(describeFsError(code), code).toBeTruthy();
    }
  });

  test("code ごとに違う文を返す", () => {
    const seen = new Set(ALL_CODES.map(describeFsError));

    expect(seen.size).toBe(ALL_CODES.length);
  });
});

describe("fsErrorPresentation", () => {
  test("どの code でも段が決まる", () => {
    for (const code of ALL_CODES) {
      expect(["warning", "danger"], code).toContain(fsErrorPresentation(code).tier);
    }
  });

  // 読み直しで結果が変わらないものに再読み込みを出すと、押しても何も起きない
  test("読み直しても直らないものは warning にしない", () => {
    for (const code of ["permission_denied", "invalid_name", "already_exists"] as const) {
      expect(fsErrorPresentation(code).tier, code).toBe("danger");
    }
  });

  test("一時的でありうるものは読み直しを促す", () => {
    for (const code of ["io", "not_found", "unknown"] as const) {
      expect(fsErrorPresentation(code).tier, code).toBe("warning");
    }
  });

  // 検証の失敗は空・ドット・パス区切り・NUL を1つの code に潰しているので、
  // 何を直せばよいかを持つのは message だけ
  test("入力が原因のものは message を本文に出す", () => {
    for (const code of ["invalid_name", "invalid_path", "invalid_destination"] as const) {
      expect(fsErrorPresentation(code).showMessage, code).toBe(true);
    }
  });

  test("Rust の生メッセージしか無いものは本文に出さない", () => {
    for (const code of ["io", "unknown", "permission_denied"] as const) {
      expect(fsErrorPresentation(code).showMessage, code).toBe(false);
    }
  });
});
