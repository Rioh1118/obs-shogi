import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** スケールに載るべきプロパティ。値は `src/index.scss` のトークンから選ぶ（ADR-0003） */
const SCALED_PROPERTIES = new Set([
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
]);

/**
 * 直値の残り件数。**下げる方向にだけ動かす。**
 * 直値をトークンへ寄せたらこの数を減らす。増やす変更は通さない。
 */
const BASELINE = {
  "font-size": 252,
  "border-radius": 179,
  spacing: 527,
  indirect: 54,
};

type Bucket = keyof typeof BASELINE;

const SRC = join(process.cwd(), "src");

/** トークンの定義そのものなので、直値があって当然のファイル */
const TOKEN_SOURCE = join(SRC, "index.scss");

/**
 * スケールに載らない寸法に付ける印。盤に従属して縮む文字のように、
 * 文字の階層と無関係な別系統がある。印は宣言と同じ行に書く
 */
const EXEMPT_MARKER = "scale-exempt";

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

/**
 * トークン参照を取り除いた残り。混在した宣言（`padding: index.$space-2 1.37rem`）から
 * 直値だけを取り出すために使う。`var(--x, 1rem)` の代替値は直値として残す
 */
function stripTokenReferences(value: string): string {
  return value.replace(/\$[\w-]+/g, "").replace(/var\(\s*--[\w-]+/g, "");
}

function hasRawLiteral(property: string, value: string): boolean {
  const pattern = property === "border-radius" ? RAW_RADIUS : RAW_LENGTH;
  return pattern.test(stripTokenReferences(value));
}

type Declaration = { property: string; value: string; line: number };

/**
 * コメントを同じ長さの空白に潰す。コメントが宣言の手前にあると、
 * その中の `:` や `/` が宣言の切り出しを壊す。改行と位置は保つ
 */
function blankComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/**
 * 宣言単位に切り出す。行単位で見ると `.a { font-size: 1rem; }` のような
 * 1行に収まった書き方や、値が次の行に折り返された宣言を取りこぼす
 */
function declarations(source: string): Declaration[] {
  const found: Declaration[] = [];
  let line = 1;
  let buffer = "";
  let bufferLine = 1;

  const flush = () => {
    const match = /(^|[{};])\s*(--[\w-]+|\$[\w-]+|[A-Za-z-]+)\s*:([^:]*)$/.exec(buffer);
    if (match) {
      found.push({
        property: match[2].toLowerCase(),
        value: match[3].trim(),
        line: bufferLine,
      });
    }
    buffer = "";
    bufferLine = line;
  };

  for (const char of source) {
    if (char === "\n") line += 1;
    if (char === ";" || char === "{" || char === "}") {
      flush();
      continue;
    }
    if (buffer === "" && /\s/.test(char)) {
      bufferLine = line;
      continue;
    }
    buffer += char;
  }

  return found;
}

/** `@include btn-size(1.2rem, 0.4rem)` のように mixin の引数へ逃がした直値 */
const INCLUDE_ARGUMENTS = /@include\s+[\w-]+\s*\(([^)]*)\)/g;

function bucketOf(property: string): Bucket | null {
  if (property === "font-size" || property === "border-radius") return property;
  if (SCALED_PROPERTIES.has(property)) return "spacing";
  // 変数とカスタムプロパティは、寸法をプロパティ名から離れた場所へ移すだけで
  // 実体は直値なので、まとめて1つの枠で数える
  if (property.startsWith("$") || property.startsWith("--")) return "indirect";
  return null;
}

function countRawDeclarations(): {
  counts: Record<Bucket, number>;
  samples: Record<Bucket, string[]>;
} {
  const counts: Record<Bucket, number> = {
    "font-size": 0,
    "border-radius": 0,
    spacing: 0,
    indirect: 0,
  };
  const samples: Record<Bucket, string[]> = {
    "font-size": [],
    "border-radius": [],
    spacing: [],
    indirect: [],
  };

  const record = (bucket: Bucket, file: string, line: number, text: string) => {
    counts[bucket] += 1;
    if (samples[bucket].length < 5) {
      samples[bucket].push(`${relative(process.cwd(), file)}:${line}  ${text}`);
    }
  };

  for (const file of scssFiles(SRC)) {
    const original = readFileSync(file, "utf8");
    const rawLines = original.split("\n");
    const source = blankComments(original);
    const isTokenSource = file === TOKEN_SOURCE;

    for (const { property, value, line } of declarations(source)) {
      const bucket = bucketOf(property);
      if (!bucket) continue;
      if (bucket === "indirect" && isTokenSource) continue;
      if (!hasRawLiteral(property, value)) continue;
      if (rawLines[line - 1]?.includes(EXEMPT_MARKER)) continue;
      record(bucket, file, line, `${property}: ${value};`);
    }

    for (const match of source.matchAll(INCLUDE_ARGUMENTS)) {
      if (!RAW_LENGTH.test(stripTokenReferences(match[1]))) continue;
      const line = source.slice(0, match.index).split("\n").length;
      record("indirect", file, line, match[0]);
    }
  }

  return { counts, samples };
}

describe("SCSS のスケール", () => {
  const { counts, samples } = countRawDeclarations();

  for (const bucket of Object.keys(BASELINE) as Bucket[]) {
    it(`${bucket} の直値が基準値と一致する`, () => {
      expect(
        counts[bucket],
        [
          `${bucket} の直値が基準値 ${BASELINE[bucket]} 件に対して ${counts[bucket]} 件ある。`,
          `増えたなら src/index.scss のトークンを使うこと（ADR-0003）。`,
          `どの宣言を足したかは git diff で見ること。スケールに載らない寸法には`,
          `宣言と同じ行に ${EXEMPT_MARKER} の印を付ければ数えない。`,
          `減ったなら BASELINE を ${counts[bucket]} に下げること。`,
          `--- 既存の直値の例（走査順の先頭。あなたが足した行とは限らない） ---`,
          ...samples[bucket],
        ].join("\n"),
      ).toBe(BASELINE[bucket]);
    });
  }
});
