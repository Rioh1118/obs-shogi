import { describe, expect, test } from "vitest";

import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";
import { withDefinitions } from "../withDefinitions";

const PRESET: EnginePreset = {
  id: "p1" as PresetId,
  label: "",
  aiName: "",
  enginePath: "/e/a",
  evalFilePath: "",
  bookEnabled: false,
  bookFilePath: null,
  options: { Threads: "999" },
};

const OUTCOME: ProbeOutcome = {
  token: 1,
  enginePath: "/e/a",
  name: "A",
  author: "x",
  definitions: [{ name: "Threads", type: "spin", default: 4, min: 1, max: 8 }],
  reserved: [],
};

describe("withDefinitions", () => {
  test("定義・取ったエンジン・時刻・名前を入れ、利用者の値には触らない", () => {
    const next = withDefinitions(PRESET, OUTCOME, "2026-09-27T00:00:00Z");

    expect(next.definitions).toEqual(OUTCOME.definitions);
    expect(next.definitionsFor).toBe("/e/a");
    expect(next.probedAt).toBe("2026-09-27T00:00:00Z");
    expect([next.engineName, next.engineAuthor]).toEqual(["A", "x"]);
    // 範囲外でも丸めない（送る側が起動のたびに申告へ当てる）
    expect(next.options).toEqual({ Threads: "999" });
  });

  test("取得を待つ間にエンジンを選び直していたら、同じ参照を返す", () => {
    const moved = { ...PRESET, enginePath: "/e/b" };
    expect(withDefinitions(moved, OUTCOME, "t")).toBe(moved);
  });
});
