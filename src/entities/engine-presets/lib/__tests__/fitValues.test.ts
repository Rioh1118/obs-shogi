import { describe, expect, test } from "vitest";

import type { UsiOptionDef } from "@/entities/engine";
import { fitValues } from "../fitValues";

// 型ごとの規則は Rust と同じ表で見る（`fitValues.ratchet.test.ts`）

describe("fitValues（名前）", () => {
  const DEFS: UsiOptionDef[] = [
    { name: "Threads", type: "spin", default: 4, min: 1, max: 512 },
    { name: "EvalFile", type: "string", default: "nn.bin" },
  ];

  test("定義に無い名前と、アプリが決める名前は外して理由と一緒に返す", () => {
    const fitted = fitValues({ NetworkDelay: "120", EvalFile: "/x/nn.bin" }, DEFS, ["EvalFile"]);
    expect(fitted.options).toEqual({});
    expect(fitted.dropped.map((d) => [d.name, d.reason])).toEqual([
      ["NetworkDelay", "notDeclared"],
      ["EvalFile", "overriddenByBinding"],
    ]);
  });

  test("丸めた値は元の値と範囲を持つ", () => {
    expect(fitValues({ Threads: "999" }, DEFS, []).clamped).toEqual([
      { name: "Threads", from: "999", value: "512", min: 1, max: 512 },
    ]);
  });
});
