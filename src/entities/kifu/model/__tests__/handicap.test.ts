import { describe, expect, test } from "vitest";
import { Shogi } from "shogi.js";
import {
  DEFAULT_HANDICAP,
  HANDICAP_PRESETS,
  isHandicapPreset,
  type HandicapPreset,
} from "../handicap";

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
});

describe("isHandicapPreset", () => {
  test("一覧にある綴りを通す", () => {
    expect(isHandicapPreset("HIRATE")).toBe(true);
    expect(isHandicapPreset("10")).toBe(true);
  });

  test("一覧に無い綴りを弾く", () => {
    // `OTHER` は `InitialPresetString` ではあるが手合割ではない
    expect(isHandicapPreset("OTHER")).toBe(false);
    expect(isHandicapPreset("")).toBe(false);
    expect(isHandicapPreset("HIRATE ")).toBe(false);
  });
});

describe("型", () => {
  test("HandicapPreset は OTHER を含まない", () => {
    // @ts-expect-error OTHER は手合割ではない
    const preset: HandicapPreset = "OTHER";
    expect(preset).toBe("OTHER");
  });
});
