import { describe, expect, test } from "vitest";
import { Shogi } from "shogi.js";
import presets from "shogi.js/cjs/presets";
import { DEFAULT_HANDICAP, HANDICAP_PRESETS, type HandicapPreset } from "../handicap";

describe("HANDICAP_PRESETS", () => {
  test("13件ある", () => {
    expect(HANDICAP_PRESETS).toHaveLength(13);
  });

  test("同じ綴りが2度出てこない", () => {
    const values = HANDICAP_PRESETS.map((preset) => preset.value);
    expect(new Set(values).size).toBe(values.length);
  });

  test("同じ表示名が2度出てこない", () => {
    const labels = HANDICAP_PRESETS.map((preset) => preset.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("先頭が平手で、既定値もそれを指す", () => {
    expect(HANDICAP_PRESETS[0].value).toBe("HIRATE");
    expect(DEFAULT_HANDICAP).toBe("HIRATE");
  });

  test("shogi.js が全ての綴りから局面を組める", () => {
    // 型は `InitialPresetString` に載っているだけで、shogi.js の presets と
    // 一致する保証は無い。組めない綴りを混ぜると、選んだ瞬間に throw する。
    for (const preset of HANDICAP_PRESETS) {
      expect(() => new Shogi({ preset: preset.value })).not.toThrow();
    }
  });

  test("shogi.js が持つ手合割のうち、出していないものを数える", () => {
    // **一覧に無い綴りが在ること自体は正しい。** 出す／出さないは画面の判断で、
    // 型はこの一覧から導いているので嘘にはならない。ここで固定するのは
    // 「知らないうちに増減していないか」だけ。
    const listed = new Set<string>(HANDICAP_PRESETS.map((p) => p.value));
    const omitted = presets.filter((p) => !listed.has(p)).sort();

    expect(omitted).toEqual(["7_L", "7_R", "HIKY"]);
  });
});

describe("型", () => {
  test("HandicapPreset は一覧に無い綴りを受け付けない", () => {
    // @ts-expect-error OTHER は手合割ではない
    const other: HandicapPreset = "OTHER";
    // @ts-expect-error HIKY は shogi.js には在るが、この一覧に無い
    const hiky: HandicapPreset = "HIKY";
    expect([other, hiky]).toEqual(["OTHER", "HIKY"]);
  });
});
