import { describe, expect, test } from "vitest";

import { MULTIPV_MAX } from "@/entities/engine-presets/model/multiPv";
import { multiPvMax, savedInt } from "../quickOptions";

describe("savedInt", () => {
  test("値が無い・整数でないなら null（エンジン既定）", () => {
    expect(savedInt({ Threads: "8" }, "Threads")).toBe(8);
    expect(savedInt({}, "Threads")).toBeNull();
    expect(savedInt({ Threads: "auto" }, "Threads")).toBeNull();
  });
});

describe("multiPvMax", () => {
  const defs = [{ name: "MultiPV", type: "spin" as const, default: 1, min: 1, max: 3 }];

  test("エンジンの申告した上限が小さければそちら", () => {
    expect(multiPvMax({ enginePath: "/e/a", definitions: defs, definitionsFor: "/e/a" })).toBe(3);
  });

  test("別のエンジンの定義・定義なしなら MULTIPV_MAX", () => {
    expect(multiPvMax({ enginePath: "/e/b", definitions: defs, definitionsFor: "/e/a" })).toBe(
      MULTIPV_MAX,
    );
    expect(multiPvMax({ enginePath: "/e/a", definitions: null, definitionsFor: null })).toBe(
      MULTIPV_MAX,
    );
  });
});
