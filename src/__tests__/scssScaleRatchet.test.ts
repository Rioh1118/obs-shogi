import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * スケールに載るべきプロパティ。値は `src/index.scss` のトークンから選ぶ（ADR-0003）。
 * box-shadow と transition は値が複合で、直値かどうかを行から判定できないため対象外。
 */
const SCALED_PROPERTIES = [
  "font-size",
  "border-radius",
  "gap",
  "row-gap",
  "column-gap",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
];

/**
 * 直値の残り件数。**下げる方向にだけ動かす。**
 * 直値をトークンへ寄せたらこの数を減らす。増やす変更は通さない。
 */
const BASELINE = {
  "font-size": 253,
  "border-radius": 176,
  spacing: 523,
};

const SRC = join(process.cwd(), "src");

function scssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scssFiles(path);
    return entry.name.endsWith(".scss") ? [path] : [];
  });
}

/** rem / px / em の直値。`0` は単位が無いのでここには掛からない */
const RAW_LENGTH = /(?<![\w$.-])\d*\.?\d+(rem|px|em)\b/;

/** 角丸は `999px`（pill）と `50%`（円）にも $radius-pill / $radius-circle という寄せ先がある */
const RAW_RADIUS = /(?<![\w$.-])\d*\.?\d+(rem|px|em|%)/;

function isRawDeclaration(property: string, value: string): boolean {
  const rawLiteral = property === "border-radius" ? RAW_RADIUS : RAW_LENGTH;
  if (!rawLiteral.test(value)) return false;
  // 1つでもトークンを参照していれば移行の途中とみなす。全部直値の宣言だけ数える
  if (/[$]|var\(/.test(value)) return false;
  return true;
}

function countRawDeclarations(): {
  counts: Record<keyof typeof BASELINE, number>;
  samples: Record<keyof typeof BASELINE, string[]>;
} {
  const counts = { "font-size": 0, "border-radius": 0, spacing: 0 };
  const samples: Record<keyof typeof BASELINE, string[]> = {
    "font-size": [],
    "border-radius": [],
    spacing: [],
  };

  for (const file of scssFiles(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const match = /^\s*([a-z-]+)\s*:\s*([^;]+);/.exec(line);
      if (!match) return;
      const [, property, value] = match;
      if (!SCALED_PROPERTIES.includes(property)) return;
      if (!isRawDeclaration(property, value)) return;

      const bucket =
        property === "font-size" || property === "border-radius" ? property : "spacing";
      counts[bucket] += 1;
      if (samples[bucket].length < 5) {
        samples[bucket].push(
          `${file.slice(process.cwd().length + 1)}:${index + 1}  ${line.trim()}`,
        );
      }
    });
  }

  return { counts, samples };
}

describe("SCSS のスケール", () => {
  const { counts, samples } = countRawDeclarations();

  for (const bucket of Object.keys(BASELINE) as (keyof typeof BASELINE)[]) {
    it(`${bucket} の直値が基準値を超えない`, () => {
      expect(
        counts[bucket],
        [
          `${bucket} の直値が ${BASELINE[bucket]} 件から ${counts[bucket]} 件に増えた。`,
          `src/index.scss のトークンを使うこと（ADR-0003）。`,
          ...samples[bucket],
        ].join("\n"),
      ).toBeLessThanOrEqual(BASELINE[bucket]);
    });
  }
});
