import { describe, expect, test } from "vitest";

import type { UsiOptionDef } from "@/entities/engine";
import { fitValues } from "../fitValues";

const DEFS: UsiOptionDef[] = [
  { name: "Threads", type: "spin", default: 4, min: 1, max: 512 },
  { name: "Ponder", type: "check", default: false },
  { name: "Style", type: "combo", default: "a", vars: ["a", "b"] },
  { name: "Path", type: "string", default: null },
  { name: "Clear", type: "button" },
  { name: "EvalFile", type: "string", default: "nn.bin" },
];

describe("fitValues", () => {
  test("型の合う値は残す。check の大小の揺れは小文字にする", () => {
    const fitted = fitValues({ Threads: "8", Ponder: "True", Style: "b", Path: "x y" }, DEFS, []);
    expect(fitted.options).toEqual({ Threads: "8", Ponder: "true", Style: "b", Path: "x y" });
    expect(fitted.clamped).toEqual([]);
    expect(fitted.dropped).toEqual([]);
  });

  test("範囲の外は丸めて返す", () => {
    const fitted = fitValues({ Threads: "999" }, DEFS, []);
    expect(fitted.options).toEqual({ Threads: "512" });
    expect(fitted.clamped).toEqual([{ name: "Threads", value: "512" }]);
  });

  test("外す値は理由と一緒に返す", () => {
    const fitted = fitValues(
      {
        NetworkDelay: "120",
        EvalFile: "/x/nn.bin",
        Style: "z",
        Ponder: "yes",
        Threads: "4.5",
        Clear: "1",
      },
      DEFS,
      ["EvalFile"],
    );
    expect(fitted.options).toEqual({});
    expect(fitted.dropped.map((d) => [d.name, d.reason])).toEqual([
      ["NetworkDelay", "notDeclared"],
      ["EvalFile", "reserved"],
      ["Style", "notInVars"],
      ["Ponder", "invalidType"],
      ["Threads", "invalidType"],
      ["Clear", "button"],
    ]);
  });
});
