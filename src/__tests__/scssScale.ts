import type { ChildNode, Comment, Declaration } from "postcss";
import scss from "postcss-scss";

/**
 * SCSS から寸法の直値を数える走査器。`scssScaleRatchet.test.ts` が
 * リポジトリ全体に掛け、`scssScale.test.ts` が個々の振る舞いを固定する。
 *
 * 値の意味は解釈しない。トークンを参照していない寸法を数えるだけ（ADR-0003）。
 * 宣言の切り出しは postcss-scss に任せる。自前で切ると、コメント・文字列・
 * 補間・エスケープのたびに穴が開き、それが「件数が減った」という形でしか現れない
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
 * `exempt` に入る。数えるのをやめるのではなく枠を移すだけにしてあるのは、
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
 * トークン参照と補間を取り除いた残り。混在した宣言
 * （`padding: index.$space-2 1.37rem`）から直値だけを取り出すために使う。
 * `var(--x, 1rem)` の代替値は直値として残す
 */
export function stripTokenReferences(value: string): string {
  return value
    .replace(/#\{[^}]*\}/g, "")
    .replace(/\$[\w-]+/g, "")
    .replace(/var\(\s*--[\w-]+/g, "");
}

export function bucketOf(property: string): Bucket | null {
  const name = property.toLowerCase();
  if (name === "font-size" || name === "border-radius") return name;
  if (SPACING_PROPERTIES.has(name)) return "spacing";
  if (ELEVATION_PROPERTIES.has(name)) return "elevation";
  if (MOTION_PROPERTIES.has(name)) return "motion";
  if (FONT_FAMILY_PROPERTIES.has(name)) return "family";
  // 変数とカスタムプロパティは、寸法をプロパティ名から離れた場所へ移すだけで
  // 実体は直値なので、まとめて1つの枠で数える
  if (name.startsWith("$") || name.startsWith("--")) return "indirect";
  return null;
}

/** 反復するアニメーションは秒単位で回り続ける別系統なので、$duration-* の寄せ先が無い */
function isLoopingAnimation(property: string, value: string): boolean {
  return property.toLowerCase().startsWith("animation") && /\binfinite\b/.test(value);
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

function isComment(node: ChildNode): node is Comment {
  return node.type === "comment";
}

/**
 * 印は**直後に続く行末コメント**だけを見る。行だけで判定すると、
 * 複数行の値を持つ宣言が、同じ行で終わる別の宣言の印まで拾う
 */
function isExempt(node: ChildNode): boolean {
  const comment = node.next();
  return (
    comment !== undefined &&
    isComment(comment) &&
    comment.source?.start?.line === node.source?.end?.line &&
    comment.text.includes(EXEMPT_MARKER)
  );
}

/** `@include name(1.2rem, 0.4rem)` のように mixin の引数へ逃がした直値 */
function includeHasRawLiteral(params: string): boolean {
  const open = params.indexOf("(");
  if (open === -1) return false;
  return RAW_LENGTH.test(stripTokenReferences(params.slice(open)));
}

/** 1ファイル分の所見。印が付いた宣言は本来の枠でなく `exempt` に入る */
export function scan(source: string, options: { tokenSource?: boolean } = {}) {
  const findings: Finding[] = [];
  const root = scss.parse(source);

  root.walkDecls((decl: Declaration) => {
    const bucket = bucketOf(decl.prop);
    if (!bucket) return;
    if (bucket === "indirect" && options.tokenSource) return;
    if (!hasRawLiteral(bucket, decl.prop, decl.value)) return;
    findings.push({
      bucket: isExempt(decl) ? "exempt" : bucket,
      line: decl.source?.start?.line ?? 0,
      text: `${decl.prop}: ${decl.value};`,
    });
  });

  root.walkAtRules("include", (rule) => {
    if (!includeHasRawLiteral(rule.params)) return;
    findings.push({
      bucket: isExempt(rule) ? "exempt" : "indirect",
      line: rule.source?.start?.line ?? 0,
      text: `@include ${rule.params};`,
    });
  });

  return findings;
}
