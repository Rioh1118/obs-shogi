import { describe, expect, test } from "vitest";

import type { UsiOptionDef } from "@/entities/engine";
import { optionRows, valuesWithoutField } from "../optionRows";

const DEFS: UsiOptionDef[] = [
  { name: "SlowMover", type: "spin", default: 100, min: 1, max: 1000 },
  { name: "Threads", type: "spin", default: 4, min: 1, max: 512 },
  { name: "Clear_Hash", type: "button" },
  { name: "EvalDir", type: "string", default: "eval" },
  { name: "USI_Ponder", type: "check", default: false },
];
const DRAFT = {
  enginePath: "/e/a",
  definitions: DEFS,
  definitionsFor: "/e/a",
  reservedNames: ["EvalDir"],
  options: { SlowMover: "8", Threads: "8", USI_Ponder: "false", NetworkDelay: "120" },
};

describe("optionRows", () => {
  test("申告の順で、button と重要オプションの名前を除き、既定と違う値と読み取り専用の名前を印す", () => {
    expect(optionRows(DRAFT).map((r) => [r.def.name, r.value, r.changed, r.reserved])).toEqual([
      ["SlowMover", "8", true, false],
      ["EvalDir", null, false, true],
      ["USI_Ponder", "false", false, false],
    ]);
  });

  test("名前の部分一致で絞る（大小を無視）", () => {
    expect(optionRows(DRAFT, "slow").map((r) => r.def.name)).toEqual(["SlowMover"]);
  });

  test("別のエンジンの定義・アプリが決める名前の無い定義なら欄を作らない", () => {
    expect(optionRows({ ...DRAFT, enginePath: "/e/b" })).toEqual([]);
    expect(optionRows({ ...DRAFT, reservedNames: undefined })).toEqual([]);
  });

  /** 同じ名前を2回申告するエンジンでも欄は1つ（最初の申告） */
  test("同じ名前の申告は1行にする", () => {
    const twice = { ...DRAFT, definitions: [...DEFS, { ...DEFS[0], max: 5 }] };
    expect(optionRows(twice).filter((r) => r.def.name === "SlowMover")).toHaveLength(1);
  });
});

describe("valuesWithoutField", () => {
  test("定義があれば、定義に無い名前だけ", () => {
    expect(valuesWithoutField(DRAFT, new Set(["MultiPV"]))).toEqual([["NetworkDelay", "120"]]);
  });

  test("定義が無ければ、別の欄を持つ名前以外の全部", () => {
    expect(valuesWithoutField({ ...DRAFT, definitions: null }, new Set(["Threads"]))).toEqual([
      ["SlowMover", "8"],
      ["USI_Ponder", "false"],
      ["NetworkDelay", "120"],
    ]);
  });
});
