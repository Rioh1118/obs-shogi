import { describe, expect, it } from "vitest";

import { asBookError } from "../error";

describe("asBookError", () => {
  it("Rust の形はそのまま受ける", () => {
    const raised = { code: "not_found", message: "ありません", path: "/books/a.db" };

    expect(asBookError(raised)).toEqual(raised);
  });

  /** 古い版に新しい種別が届いても、利用者に見せる文は残す */
  it("知らない code は unknown にして、残りの欄を拾う", () => {
    const raised = { code: "brand_new", message: "新しい失敗", path: "/books/a.db" };

    expect(asBookError(raised)).toEqual({ ...raised, code: "unknown" });
  });

  it("path が文字列でなければ null にする", () => {
    expect(asBookError({ code: "io", message: "m" }).path).toBeNull();
    expect(asBookError({ code: "io", message: "m", path: 3 }).path).toBeNull();
  });

  it("message の無い値は文字列にして unknown で返す", () => {
    expect(asBookError("落ちた")).toEqual({ code: "unknown", message: "落ちた", path: null });
    expect(asBookError(null)).toEqual({ code: "unknown", message: "null", path: null });
    expect(asBookError(undefined).code).toBe("unknown");
    expect(asBookError({ code: "io" }).code).toBe("unknown");
  });
});
