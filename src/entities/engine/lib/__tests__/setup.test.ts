import { describe, expect, test } from "vitest";
import type { EngineRuntimeConfig } from "@/entities/engine/model/types";
import { usiOptionsOf } from "../setup";

const CONFIG: EngineRuntimeConfig = {
  enginePath: "/ai/engines/yaneuraou",
  workDir: "/ai/yaneuraou",
  evalDir: "/ai/eval/suisho",
  bookDir: "/ai/book",
  bookFile: "user_book1.db",
  options: { Threads: "4", USI_Hash: "1024", MultiPV: "3" },
};

/**
 * **順序がそのまま送られる**（`start_analysis_engine` は並べた順に `setoption` を送る）。
 * プリセットの値が先、置き場（`EvalDir` / `BookDir` / `BookFile`）が後。
 */
describe("usiOptionsOf", () => {
  test("プリセットの値を先に、置き場を後に並べる", () => {
    expect(usiOptionsOf(CONFIG).map((option) => option.name)).toEqual([
      "Threads",
      "USI_Hash",
      "MultiPV",
      "EvalDir",
      "BookDir",
      "BookFile",
    ]);
  });

  test("プリセットが置き場と同じ名前を持つなら、位置は先のまま値は置き場のもの", () => {
    const options = usiOptionsOf({ ...CONFIG, options: { EvalDir: "/stale", Threads: "4" } });

    expect(options[0]).toEqual({ name: "EvalDir", value: "/ai/eval/suisho" });
    expect(options.filter((option) => option.name === "EvalDir")).toHaveLength(1);
  });

  test("定跡の置き場が無ければ送らない", () => {
    const names = usiOptionsOf({ ...CONFIG, bookDir: null, bookFile: null }).map((o) => o.name);

    expect(names).not.toContain("BookDir");
    expect(names).not.toContain("BookFile");
  });
});
