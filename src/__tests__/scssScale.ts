/**
 * SCSS から寸法の直値を数える走査器。`scssScaleRatchet.test.ts` が
 * リポジトリ全体に掛け、`scssScale.test.ts` が個々の振る舞いを固定する。
 *
 * 値の意味は解釈しない。トークンを参照していない寸法を数えるだけ（ADR-0003）。
 */

/** スケールに載るべきプロパティ。値は `src/index.scss` のトークンから選ぶ */
const SPACING_PROPERTIES = new Set([
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
  // 論理プロパティ。まだ使用例は無いが、物理プロパティだけ塞ぐと寄せ道になる
  "padding-inline",
  "padding-block",
  "padding-inline-start",
  "padding-inline-end",
  "padding-block-start",
  "padding-block-end",
  "margin-inline",
  "margin-block",
  "margin-inline-start",
  "margin-inline-end",
  "margin-block-start",
  "margin-block-end",
]);

const ELEVATION_PROPERTIES = new Set(["box-shadow", "text-shadow"]);

const MOTION_PROPERTIES = new Set([
  "transition",
  "transition-duration",
  "transition-delay",
  "animation",
  "animation-duration",
  "animation-delay",
]);

const FONT_FAMILY_PROPERTIES = new Set(["font-family"]);

export const BUCKETS = [
  "font-size",
  "border-radius",
  "spacing",
  "elevation",
  "motion",
  "family",
  "indirect",
  "exempt",
] as const;

export type Bucket = (typeof BUCKETS)[number];

/**
 * スケールに載らない寸法に付ける印。印を付けた宣言は本来の枠でなく
 * `exempt` に入る。数えるのをやめるのではなく、枠を移すだけにしてあるのは、
 * 印を増やす変更を基準値の差分としてレビューに出すため
 */
export const EXEMPT_MARKER = "scale-exempt";

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
 * トークン参照を取り除いた残り。混在した宣言（`padding: index.$space-2 1.37rem`）から
 * 直値だけを取り出すために使う。`var(--x, 1rem)` の代替値は直値として残す
 */
export function stripTokenReferences(value: string): string {
  return value.replace(/\$[\w-]+/g, "").replace(/var\(\s*--[\w-]+/g, "");
}

export type Declaration = {
  property: string;
  value: string;
  /** 1 始まり。宣言が複数行にまたがる場合はプロパティ名のある行 */
  line: number;
  /** 宣言が占める最後の行。印はこの範囲のどこに書いてもよい */
  endLine: number;
};

type ScanState = {
  /** 文字列リテラルの中。閉じ引用符まで区切り文字を無視する */
  quote: string | null;
  /** `url(` の中。引用符無しでも `//` や `;` が現れる */
  urlDepth: number;
  /** ブロックコメントの中 */
  inBlockComment: boolean;
  /** 行コメントの中 */
  inLineComment: boolean;
};

function initialState(): ScanState {
  return { quote: null, urlDepth: 0, inBlockComment: false, inLineComment: false };
}

/**
 * 宣言単位に切り出す。行単位で見ると `.a { font-size: 1rem; }` のような
 * 1行に収まった書き方や、値が次の行に折り返された宣言を取りこぼす。
 *
 * 文字列と `url()` の中では区切り文字とコメント開始を無視する。
 * これを見ないと `url(https://…)` の `//` 以降が丸ごと消え、
 * 同じ行の宣言まで数から落ちる
 */
export function declarations(source: string): Declaration[] {
  const found: Declaration[] = [];
  const state = initialState();
  let line = 1;
  let buffer = "";
  let bufferLine = 1;

  const flush = () => {
    // プロパティ名の直後の `:` で切る。値に `:` を含む Sass マップや
    // data URI を落とさないため、値の側は何でも許す
    const match = /(^|[{};])\s*(--[\w-]+|\$[\w-]+|[A-Za-z-]+)\s*:([\s\S]*)$/.exec(buffer);
    if (match) {
      found.push({
        property: match[2].toLowerCase(),
        value: match[3].trim(),
        line: bufferLine,
        endLine: line,
      });
    }
    buffer = "";
    bufferLine = line;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "\n") {
      line += 1;
      state.inLineComment = false;
      if (buffer === "") bufferLine = line;
      continue;
    }
    if (state.inLineComment) continue;
    if (state.inBlockComment) {
      if (char === "*" && next === "/") {
        state.inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (state.quote) {
      if (char === state.quote) state.quote = null;
      buffer += char;
      continue;
    }
    if (char === '"' || char === "'") {
      state.quote = char;
      buffer += char;
      continue;
    }
    if (state.urlDepth > 0) {
      if (char === "(") state.urlDepth += 1;
      if (char === ")") state.urlDepth -= 1;
      buffer += char;
      continue;
    }
    if (char === "/" && next === "/") {
      state.inLineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state.inBlockComment = true;
      i += 1;
      continue;
    }
    if (char === "(" && /url\s*$/i.test(buffer)) {
      state.urlDepth = 1;
      buffer += char;
      continue;
    }
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

/**
 * `@include name(...)` の引数。括弧の深さを数える。
 * `[^)]*` では `@include btn-active(color.adjust($c, $lightness: -5%))` のように
 * 引数に関数を置いた時点で、それ以降の直値が全部見えなくなる
 */
export function includeArguments(
  source: string,
): { args: string; line: number; endLine: number; text: string }[] {
  const found: { args: string; line: number; endLine: number; text: string }[] = [];
  const opening = /@include\s+[\w-]+\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = opening.exec(source)) !== null) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "(") depth += 1;
      if (source[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) continue;

    const text = source.slice(match.index, cursor);
    const line = source.slice(0, match.index).split("\n").length;
    found.push({
      args: source.slice(match.index + match[0].length, cursor - 1),
      line,
      endLine: line + text.split("\n").length - 1,
      text,
    });
    opening.lastIndex = cursor;
  }

  return found;
}

export function bucketOf(property: string): Bucket | null {
  if (property === "font-size" || property === "border-radius") return property;
  if (SPACING_PROPERTIES.has(property)) return "spacing";
  if (ELEVATION_PROPERTIES.has(property)) return "elevation";
  if (MOTION_PROPERTIES.has(property)) return "motion";
  if (FONT_FAMILY_PROPERTIES.has(property)) return "family";
  // 変数とカスタムプロパティは、寸法をプロパティ名から離れた場所へ移すだけで
  // 実体は直値なので、まとめて1つの枠で数える
  if (property.startsWith("$") || property.startsWith("--")) return "indirect";
  return null;
}

/** 反復するアニメーションは秒単位で回り続ける別系統なので、$duration-* の寄せ先が無い */
function isLoopingAnimation(property: string, value: string): boolean {
  return property.startsWith("animation") && /\binfinite\b/.test(value);
}

export function hasRawLiteral(bucket: Bucket, property: string, value: string): boolean {
  const rest = stripTokenReferences(value);
  if (bucket === "border-radius") return RAW_RADIUS.test(rest);
  if (bucket === "motion") {
    return RAW_DURATION.test(rest) && !isLoopingAnimation(property, rest);
  }
  // フォントは長さを持たない。寄せ先が要るのは、総称名まで並べたスタックを
  // 直書きしている場合だけ。`inherit` や単一の総称名はトークンにする意味が無い
  if (bucket === "family") return rest.includes(",");
  return RAW_LENGTH.test(rest);
}

export type Finding = { bucket: Bucket; line: number; text: string };

/** 1ファイル分の所見。印が付いた宣言は本来の枠でなく `exempt` に入る */
export function scan(source: string, options: { tokenSource?: boolean } = {}) {
  const rawLines = source.split("\n");
  const isExempt = (from: number, to: number) =>
    rawLines.slice(from - 1, to).some((text) => text.includes(EXEMPT_MARKER));

  const findings: Finding[] = [];

  for (const { property, value, line, endLine } of declarations(source)) {
    const bucket = bucketOf(property);
    if (!bucket) continue;
    if (bucket === "indirect" && options.tokenSource) continue;
    if (!hasRawLiteral(bucket, property, value)) continue;
    findings.push({
      bucket: isExempt(line, endLine) ? "exempt" : bucket,
      line,
      text: `${property}: ${value};`,
    });
  }

  for (const { args, line, endLine, text } of includeArguments(source)) {
    if (!RAW_LENGTH.test(stripTokenReferences(args))) continue;
    findings.push({
      bucket: isExempt(line, endLine) ? "exempt" : "indirect",
      line,
      text,
    });
  }

  return findings;
}
