import { describe, expect, test } from "vitest";
import type { EngineRuntimeConfig } from "@/entities/engine/model/types";
import { equalRuntime } from "../equalRuntime";
import { valuesOf } from "../setup";

const CONFIG: EngineRuntimeConfig = {
  enginePath: "/ai/engines/yaneuraou",
  evalPath: "/ai/suisho/eval/nn.bin",
  book: { path: "/ai/suisho/book/standard_book.db", useInAnalysis: true },
  values: { Threads: "4", USI_Hash: "1024", MultiPV: "3" },
};

/**
 * **TS は USI の名前を足さない。** 評価関数・定跡・固定値の名前は Rust が起動のたびの申告から
 * 決める（`binding.rs`）。足すと、申告しないエンジン（zermelo の `EvalDir`）に届かない名前を送る
 */
describe("valuesOf", () => {
  test("利用者の値だけを送る形にし、評価関数・定跡の名前を足さない", () => {
    const names = valuesOf(CONFIG).map((option) => option.name);

    expect(names).toEqual(["Threads", "USI_Hash", "MultiPV"]);
    for (const usiName of ["EvalDir", "EvalFile", "BookDir", "BookFile", "USI_OwnBook"]) {
      expect(names).not.toContain(usiName);
    }
  });
});

describe("equalRuntime", () => {
  /** 送る順は Rust が申告から決めるので、利用者の値の並びでは起動し直さない */
  test("利用者の値は名前で比べ、並びを見ない", () => {
    const reordered = { ...CONFIG, values: { MultiPV: "3", Threads: "4", USI_Hash: "1024" } };
    expect(equalRuntime(CONFIG, reordered)).toBe(true);
  });

  test("評価関数・定跡・解析で使うかのどれが変わっても起動し直す", () => {
    expect(equalRuntime(CONFIG, { ...CONFIG, evalPath: "/ai/suisho/eval/other.bin" })).toBe(false);
    expect(equalRuntime(CONFIG, { ...CONFIG, evalPath: null })).toBe(false);
    expect(
      equalRuntime(CONFIG, { ...CONFIG, book: { path: "/b/other.db", useInAnalysis: true } }),
    ).toBe(false);
    expect(
      equalRuntime(CONFIG, { ...CONFIG, book: { ...CONFIG.book!, useInAnalysis: false } }),
    ).toBe(false);
    expect(equalRuntime(CONFIG, { ...CONFIG, values: { ...CONFIG.values, Threads: "8" } })).toBe(
      false,
    );
  });
});
