import { describe, expect, test } from "vitest";

import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset, PresetId } from "@/entities/engine-presets/model/types";
import { hasCurrentDefinitions, withDefinitions } from "../withDefinitions";

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
  reserved: ["EvalFile"],
};

describe("withDefinitions", () => {
  test("定義・取ったエンジン・時刻・名前を入れ、利用者の値には触らない", () => {
    const next = withDefinitions(PRESET, OUTCOME, "2026-09-27T00:00:00Z");

    expect(next.definitions).toEqual(OUTCOME.definitions);
    expect(next.definitionsFor).toBe("/e/a");
    expect(next.reservedNames).toEqual(OUTCOME.reserved);
    expect(next.probedAt).toBe("2026-09-27T00:00:00Z");
    expect([next.engineName, next.engineAuthor]).toEqual(["A", "x"]);
    // この関数は値に触らない（値を定義に当てるのは別の段）
    expect(next.options).toEqual({ Threads: "999" });
  });

  test("取得を待つ間にエンジンを選び直していたら、同じ参照を返す", () => {
    const moved = { ...PRESET, enginePath: "/e/b" };
    expect(withDefinitions(moved, OUTCOME, "t")).toBe(moved);
  });

  test("手で打ったパスの前後の空白は落として比べ、定義を取ったパスは空白無しで残す", () => {
    const next = withDefinitions({ ...PRESET, enginePath: " /e/a " }, OUTCOME, "t");
    expect(next.definitionsFor).toBe("/e/a");
    expect(hasCurrentDefinitions(next)).toBe(true);
  });

  test("別のエンジンの定義はいまの定義でない", () => {
    const next = withDefinitions(PRESET, OUTCOME, "t");
    expect(hasCurrentDefinitions({ ...next, enginePath: "/e/b" })).toBe(false);
    expect(hasCurrentDefinitions(PRESET)).toBe(false);
  });
});
