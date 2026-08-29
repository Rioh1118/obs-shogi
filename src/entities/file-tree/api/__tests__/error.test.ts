import { describe, expect, test } from "vitest";
import {
  asFsError,
  describeFsError,
  fsErrorTier,
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
  "invalid_name_empty",
  "invalid_name_reserved",
  "invalid_name_separator",
  "invalid_name_control",
  "invalid_path",
  "invalid_type",
  "invalid_extension",
  "invalid_destination",
  "kifu_conversion_failed",
  "permission_denied",
  "io",
  "kifu_format_unknown",
  "kifu_parse_failed",
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

  /**
   * Tauri の reject 値はプレーンオブジェクト。まとめて `String()` に落とすと
   * `[object Object]` になり、どのファイルで何が起きたかまで消える。
   * Rust に code を1つ足しただけでこの経路に入るので、実際に起きる形で踏む。
   */
  test("知らない code でも path と message は捨てない", () => {
    const res = asFsError({
      code: "kifu_conversion_failed_v2",
      message: "normalize failed",
      path: "/root/a.kif",
      existingPath: "/root/b.kif",
    });

    expect(res.code).toBe("unknown");
    expect(res.message).toBe("normalize failed");
    expect(res.path).toBe("/root/a.kif");
    expect(res.existingPath).toBe("/root/b.kif");
    expect(res.cause).toContain("kifu_conversion_failed_v2");
  });

  test("message すら無いオブジェクトでも [object Object] にしない", () => {
    expect(asFsError({ code: "???", path: "/root/a.kif" }).message).toContain("/root/a.kif");
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

  // 名前の検証は原因ごとに code を分けてある。同じ文に潰すと分けた意味が消える
  test("名前の検証は原因ごとに違う直し方を示す", () => {
    expect(describeFsError("invalid_name_separator")).toContain("/");
    expect(describeFsError("invalid_name_empty")).not.toBe(
      describeFsError("invalid_name_separator"),
    );
  });
});

describe("fsErrorTier", () => {
  test("どの code でも段が決まる", () => {
    for (const code of ALL_CODES) {
      expect(["warning", "danger"], code).toContain(fsErrorTier(code));
    }
  });

  // 読み直しで結果が変わらないものに再読み込みを出すと、押しても何も起きない
  test("読み直しても直らないものは warning にしない", () => {
    for (const code of [
      "permission_denied",
      "invalid_name_separator",
      "already_exists",
      "kifu_parse_failed",
    ] as const) {
      expect(fsErrorTier(code), code).toBe("danger");
    }
  });

  test("一時的でありうるものは読み直しを促す", () => {
    for (const code of ["io", "not_found", "unknown"] as const) {
      expect(fsErrorTier(code), code).toBe("warning");
    }
  });
});
