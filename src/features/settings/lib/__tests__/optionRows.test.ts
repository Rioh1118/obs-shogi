import { describe, expect, test } from "vitest";

import type { UsiOptionDef } from "@/entities/engine";
import { optionRows } from "../optionRows";

const DEFS: UsiOptionDef[] = [
  { name: "NumaPolicy", type: "string", default: "auto", label: "CPU のスレッド割り当て" },
  { name: "USI_Hash", type: "spin", default: 1024, min: 1, max: 65536, label: "ハッシュ（MB）" },
  { name: "MultiPV", type: "spin", default: 1, min: 1, max: 600, label: "候補手の数" },
  { name: "Clear_Hash", type: "button" },
  { name: "EvalDir", type: "string", default: "eval", label: "評価関数のフォルダ" },
  {
    name: "BookMoves",
    type: "spin",
    default: 16,
    min: 0,
    max: 10000,
    label: "定跡を使う手数",
    group: "book",
  },
  { name: "EvalShareMode", type: "check", default: false },
  { name: "Threads", type: "spin", default: 4, min: 1, max: 512, label: "スレッド数" },
];
const DRAFT = {
  enginePath: "/e/a",
  definitions: DEFS,
  definitionsFor: "/e/a",
  reservedNames: ["EvalDir"],
  options: { Threads: "8", NumaPolicy: "auto" },
};
const names = (rows: { def: { name: string } }[]) => rows.map((r) => r.def.name);

describe("optionRows", () => {
  test("スレッド数とハッシュを先頭に、続けて申告の順。button・アプリが決める名前・候補手の数は出さない", () => {
    expect(names(optionRows(DRAFT, { bookUsed: true }))).toEqual([
      "Threads",
      "USI_Hash",
      "NumaPolicy",
      "BookMoves",
      "EvalShareMode",
    ]);
  });

  test("定跡を使わないときは定跡の設定を出さない", () => {
    expect(names(optionRows(DRAFT, { bookUsed: false }))).not.toContain("BookMoves");
  });

  test("画面の名前を持ち、辞書に無ければ null", () => {
    const rows = optionRows(DRAFT, { bookUsed: true });
    expect(rows.find((r) => r.def.name === "Threads")?.label).toBe("スレッド数");
    expect(rows.find((r) => r.def.name === "EvalShareMode")?.label).toBeNull();
  });

  test("日本語の名前でもエンジンの綴りでも探せる", () => {
    expect(names(optionRows(DRAFT, { bookUsed: true, query: "ハッシュ" }))).toEqual(["USI_Hash"]);
    expect(names(optionRows(DRAFT, { bookUsed: true, query: "numa" }))).toEqual(["NumaPolicy"]);
  });

  test("初期値と違う値だけに絞れる（初期値と同じ値は数えない）", () => {
    expect(names(optionRows(DRAFT, { bookUsed: true, changedOnly: true }))).toEqual(["Threads"]);
  });

  test("別のエンジンの定義・アプリが決める名前の無い定義なら行を作らない", () => {
    expect(optionRows({ ...DRAFT, enginePath: "/e/b" }, { bookUsed: true })).toEqual([]);
    expect(optionRows({ ...DRAFT, reservedNames: undefined }, { bookUsed: true })).toEqual([]);
  });

  /** 同じ名前を2回申告するエンジンでも行は1つ（最初の申告） */
  test("同じ名前の申告は1行にする", () => {
    const twice = { ...DRAFT, definitions: [...DEFS, { ...DEFS[0] }] };
    expect(
      names(optionRows(twice, { bookUsed: true })).filter((n) => n === "NumaPolicy"),
    ).toHaveLength(1);
  });
});
