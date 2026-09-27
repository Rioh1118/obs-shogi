import { describe, expect, test } from "vitest";

import type { EnginePreset } from "@/entities/engine-presets/model/types";
import { createDefaultPreset, normalizeOnePreset } from "../normalize";

/**
 * 値の無い名前は**エンジン既定**（送らない）。読み込んだプリセットに値を足すと、利用者が選んでいない
 * 値をエンジンに送る
 */
describe("プリセットの値", () => {
  test("新しいプリセットは MultiPV だけを持つ", () => {
    expect(createDefaultPreset().options).toEqual({ MultiPV: "5" });
  });

  test("読み込んだプリセットには値を足さない", () => {
    const loaded = normalizeOnePreset({
      id: "p1",
      options: { Threads: "8" },
    } as Partial<EnginePreset>);
    expect(loaded.options).toEqual({ Threads: "8" });

    const empty = normalizeOnePreset({ id: "p2" } as Partial<EnginePreset>);
    expect(empty.options).toEqual({});
  });

  test("保存済みの値は、利用者が触っていないものでも消さない", () => {
    const loaded = normalizeOnePreset({
      id: "p1",
      options: { NetworkDelay: "120", SlowMover: "100", Threads: " 4 ", Empty: " " },
    } as Partial<EnginePreset>);
    expect(loaded.options).toEqual({ NetworkDelay: "120", SlowMover: "100", Threads: "4" });
  });
});
