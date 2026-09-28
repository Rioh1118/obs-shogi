import { describe, expect, test } from "vitest";

import { MULTIPV_MAX } from "@/entities/engine-presets/model/multiPv";
import { engineDefaultLabel, engineDefaultOf, multiPvMax, savedInt } from "../quickOptions";

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
    expect(
      multiPvMax({
        enginePath: "/e/a",
        definitions: defs,
        definitionsFor: "/e/a",
        reservedNames: [],
      }),
    ).toBe(3);
  });

  test("別のエンジンの定義・定義なしなら MULTIPV_MAX", () => {
    expect(
      multiPvMax({
        enginePath: "/e/b",
        definitions: defs,
        definitionsFor: "/e/a",
        reservedNames: [],
      }),
    ).toBe(MULTIPV_MAX);
    expect(
      multiPvMax({
        enginePath: "/e/a",
        definitions: null,
        definitionsFor: null,
        reservedNames: null,
      }),
    ).toBe(MULTIPV_MAX);
  });
});

describe("engineDefaultOf", () => {
  const defs = [
    { name: "MultiPV", type: "spin" as const, default: 1, min: 1, max: 500 },
    { name: "Clear", type: "button" as const },
  ];

  test("いまのエンジンの定義の既定値。分からなければ null", () => {
    const current = {
      enginePath: "/e/a",
      definitions: defs,
      definitionsFor: "/e/a",
      reservedNames: [],
    };
    expect(engineDefaultOf(current, "MultiPV")).toBe("1");
    expect(engineDefaultOf(current, "Clear")).toBeNull();
    expect(engineDefaultOf(current, "Threads")).toBeNull();
    expect(engineDefaultOf({ ...current, enginePath: "/e/b" }, "MultiPV")).toBeNull();
  });

  test("既定値が分かれば「エンジン既定」に添える", () => {
    expect(engineDefaultLabel("1024", "MB")).toBe("エンジン既定（1024MB）");
    expect(engineDefaultLabel(null)).toBe("エンジン既定");
  });
});
