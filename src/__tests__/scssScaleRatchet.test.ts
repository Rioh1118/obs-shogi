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
  spacing: 529,
  elevation: 80,
  motion: 84,
  indirect: 53,
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

/**
 * rem / px / em の直値。`0` は単位が無いのでここには掛からない。
 * 符号を含めて拾う。負のマージンを抜け道にしないため
 */
const RAW_LENGTH = /(?<![\w$.])-?\d*\.?\d+(rem|px|em)\b/;

/** 角丸は `999px`（pill）と `50%`（円）にも $radius-pill / $radius-circle という寄せ先がある */
const RAW_RADIUS = /(?<![\w$.])-?\d*\.?\d+(rem|px|em|%)/;

/** モーションの直値。時間は長さと単位が違うので別に見る */
const RAW_DURATION = /(?<![\w$.])-?\d*\.?\d+m?s\b/;

/**
 * ローディングの反復は秒単位で回り続ける別系統なので、$duration-* の寄せ先が無い。
 * 実測では 1s 以上がそれにあたる
 */
const LOOPING_ANIMATION = /(?<![\w$.])-?(?:[1-9]\d*(?:\.\d+)?s|\d{4,}ms)\b/;

/**
 * トークン参照を取り除いた残り。混在した宣言（`padding: index.$space-2 1.37rem`）から
 * 直値だけを取り出すために使う。`var(--x, 1rem)` の代替値は直値として残す
 */
function stripTokenReferences(value: string): string {
  return value.replace(/\$[\w-]+/g, "").replace(/var\(\s*--[\w-]+/g, "");
}

function hasRawLiteral(bucket: Bucket, value: string): boolean {
  const rest = stripTokenReferences(value);
  if (bucket === "border-radius") return RAW_RADIUS.test(rest);
  if (bucket === "motion") {
    return RAW_DURATION.test(rest) && !LOOPING_ANIMATION.test(rest);
  }
  return RAW_LENGTH.test(rest);
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

const ELEVATION_PROPERTIES = new Set(["box-shadow", "text-shadow"]);
const MOTION_PROPERTIES = new Set([
  "transition",
  "transition-duration",
  "transition-delay",
  "animation",
  "animation-duration",
  "animation-delay",
]);

function bucketOf(property: string): Bucket | null {
  if (property === "font-size" || property === "border-radius") return property;
  if (SCALED_PROPERTIES.has(property)) return "spacing";
  if (ELEVATION_PROPERTIES.has(property)) return "elevation";
  if (MOTION_PROPERTIES.has(property)) return "motion";
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
    elevation: 0,
    motion: 0,
    indirect: 0,
  };
  const samples: Record<Bucket, string[]> = {
    "font-size": [],
    "border-radius": [],
    spacing: [],
    elevation: [],
    motion: [],
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
      if (!hasRawLiteral(bucket, value)) continue;
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

/** `$name: ...` の定義。`@use` の名前空間があるので同名でもコンパイルは通る */
const VARIABLE_DEFINITION = /^\s*\$([\w-]+)\s*:/gm;

function definedIn(file: string): Set<string> {
  const names = new Set<string>();
  for (const match of blankComments(readFileSync(file, "utf8")).matchAll(VARIABLE_DEFINITION)) {
    names.add(match[1]);
  }
  return names;
}

describe("SCSS のトークン名", () => {
  it("ファイルローカルの変数がトークンと同名にならない", () => {
    const tokens = definedIn(TOKEN_SOURCE);
    const collisions = scssFiles(SRC)
      .filter((file) => file !== TOKEN_SOURCE)
      .flatMap((file) =>
        [...definedIn(file)]
          .filter((name) => tokens.has(name))
          .map((name) => `${relative(process.cwd(), file)}  $${name}`),
      );

    expect(
      collisions,
      [
        "トークンと同名のローカル変数がある。名前空間が違うのでコンパイルは通るが、",
        "同じ名前が同じファイルの中で別の値を持つ。トークンへ寄せる置換で値が黙って変わる。",
        ...collisions,
      ].join("\n"),
    ).toEqual([]);
  });
});

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
