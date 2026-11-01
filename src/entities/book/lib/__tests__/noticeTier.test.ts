import { describe, expect, it } from "vitest";

import type { BookFailure } from "@/entities/book/model/context";
import type { BookErrorCode } from "@/entities/book/model/types";
import { bookNoticeTier } from "../noticeTier";

const failure = (code: BookErrorCode, origin: BookFailure["origin"] = "open"): BookFailure => ({
  origin,
  error: { code, message: "m", path: null },
});

describe("bookNoticeTier", () => {
  it.each(["io", "unknown"] as const)("%s は押し直せば直りうる", (code) => {
    expect(bookNoticeTier(failure(code))).toBe("warning");
  });

  it.each([
    "not_found",
    "permission_denied",
    "invalid_type",
    "invalid_path",
    "unknown_extension",
    "unsupported_format",
    "invalid_content",
    "too_large",
    "invalid_handle",
    "invalid_sfen",
  ] as const)("%s は別の操作が要る", (code) => {
    expect(bookNoticeTier(failure(code))).toBe("danger");
  });

  it("定跡の外の失敗は code によらず別の操作が要る", () => {
    expect(bookNoticeTier(failure("io", "external"))).toBe("danger");
  });
});
