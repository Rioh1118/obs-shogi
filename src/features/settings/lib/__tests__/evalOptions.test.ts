import { describe, expect, test } from "vitest";

import type { ProfileCandidate } from "@/entities/ai-library/api/aiLibrary";
import { evalOptionsFor } from "../evalOptions";

const profile = (name: string, options: [string, string][]): ProfileCandidate => ({
  name,
  path: `/ai/${name}`,
  has_eval_dir: true,
  has_book_dir: false,
  eval_files: [{ entry: "nn.bin", path: `/ai/${name}/eval/nn.bin`, kind: "file" }],
  eval_options: options.map(([n, value]) => ({ name: n, value })),
  eval_options_outside_eval: false,
  book_files: [],
});

describe("evalOptionsFor", () => {
  const PROFILES = [profile("a", [["FV_SCALE", "24"]]), profile("b", [["FV_SCALE", "40"]])];

  test("選んだ評価関数のフォルダの値を返す", () => {
    expect(evalOptionsFor(PROFILES, "/ai/b/eval/nn.bin").get("FV_SCALE")).toBe("40");
  });

  test("AI ライブラリの外の評価関数と、選んでいないときは空", () => {
    expect(evalOptionsFor(PROFILES, "/elsewhere/nn.bin").size).toBe(0);
    expect(evalOptionsFor(PROFILES, "").size).toBe(0);
  });
});
