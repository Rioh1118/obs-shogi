import type { ChildNode, Container, Declaration } from "postcss";
import scss from "postcss-scss";

/**
 * SCSS から「文字と、その文字が載る面」の対を取り出してコントラスト比を測る走査器。
 *
 * 人の目では止まらないので機械で止める。文字と面は宣言する場所が離れるので、
 * 同じコミットの中でも片方だけ測って通ってしまう。
 *
 * 測れるのは**面が不透明に確定する対だけ**。半透明の面を親に重ねているだけの
 * 部品は、どの親に載るかで実効値が変わるので判定しない。
 *
 * **測れた対と測れなかった宣言の両方を返す。** 割った対だけを返すと、
 * 面を半透明にするだけで対が検査から静かに消え、テストは緑のままになる。
 * 数えられていることそのものを呼び出し側がラチェットできるようにする。
 */

export type Rgba = { r: number; g: number; b: number; a: number };

/** 本文の基準（WCAG AA）。1rem = 10px */
export const AA_NORMAL = 4.5;
/** 24px 以上、または 18.66px 以上の太字は大きい文字として 3:1 でよい */
export const AA_LARGE = 3;

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function parseHex(hex: string): Rgba | null {
  const body = hex.slice(1);
  if (body.length === 3) {
    const [r, g, b] = [...body].map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  if (body.length === 6) {
    return {
      r: parseInt(body.slice(0, 2), 16),
      g: parseInt(body.slice(2, 4), 16),
      b: parseInt(body.slice(4, 6), 16),
      a: 1,
    };
  }
  return null;
}

/**
 * `fn(a, b(c, d))` を最外の関数名と、深さを保った引数に割る。
 * 正規表現で切ると `rgba($x, 0.1)` を含む `color-mix` の引数がずれる
 */
function splitCall(value: string): { name: string; args: string[] } | null {
  const open = value.indexOf("(");
  if (open < 0 || !value.trimEnd().endsWith(")")) return null;
  const name = value.slice(0, open).trim().toLowerCase();
  if (!/^[\w-]+$/.test(name)) return null;

  const inner = value.slice(open + 1, value.lastIndexOf(")"));
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  args.push(current.trim());
  return { name, args };
}

/** `color-mix(in srgb, A p%, B)` の重みを取り出す。片方だけに % が付く書き方も拾う */
function parseMix(args: string[], vars: Map<string, string>): Rgba | null {
  if (args.length !== 3) return null;
  if (!/^in\s+srgb$/i.test(args[0])) return null;

  const parts = args.slice(1).map((arg) => {
    const m = arg.match(/^(.*?)\s+(\d*\.?\d+)%$/);
    return m
      ? { color: resolveColor(m[1], vars), weight: Number(m[2]) / 100 }
      : { color: resolveColor(arg, vars), weight: null };
  });

  const [first, second] = parts;
  if (!first.color || !second.color) return null;

  const w1 = first.weight ?? (second.weight === null ? 0.5 : 1 - second.weight);
  const w2 = second.weight ?? 1 - w1;
  if (Math.abs(w1 + w2 - 1) > 1e-6) return null;

  return {
    r: first.color.r * w1 + second.color.r * w2,
    g: first.color.g * w1 + second.color.g * w2,
    b: first.color.b * w1 + second.color.b * w2,
    a: first.color.a * w1 + second.color.a * w2,
  };
}

/**
 * 値を1つの色に解く。解けなければ `null`。
 *
 * `null` は「透明」でも「合格」でもなく**測れない**という意味。呼び出し側は
 * 測れなかった対を落とす。グラデーションや `currentColor` がここに来る
 */
export function resolveColor(raw: string, vars: Map<string, string>): Rgba | null {
  const value = raw.trim().replace(/\s*!(default|important)\s*$/, "");
  if (!value) return null;

  if (value in NAMED) return NAMED[value];
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(value)) return parseHex(value);

  const varMatch = value.match(/^(?:[\w-]+\.)?(\$[\w-]+)$/);
  if (varMatch) {
    const referenced = vars.get(varMatch[1]);
    return referenced === undefined ? null : resolveColor(referenced, vars);
  }

  const call = splitCall(value);
  if (!call) return null;

  if (call.name === "color-mix") return parseMix(call.args, vars);

  if (call.name === "rgba" || call.name === "rgb") {
    if (call.args.length === 2) {
      const base = resolveColor(call.args[0], vars);
      const alpha = Number(call.args[1]);
      if (!base || Number.isNaN(alpha)) return null;
      return { ...base, a: base.a * alpha };
    }
    if (call.args.length === 3 || call.args.length === 4) {
      const nums = call.args.map(Number);
      if (nums.some(Number.isNaN)) return null;
      return {
        r: clamp255(nums[0]),
        g: clamp255(nums[1]),
        b: clamp255(nums[2]),
        a: call.args.length === 4 ? nums[3] : 1,
      };
    }
  }

  return null;
}

/** 半透明の `fg` を不透明な `bg` の上に重ねた結果 */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgba): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** `$name: value;` を集める。トークンが別のトークンを参照していても解けるよう、生の文字列で持つ */
export function collectVariables(source: string, into = new Map<string, string>()) {
  const root = scss.parse(source);
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("$")) into.set(decl.prop, decl.value);
  });
  return into;
}

export type ContrastPair = {
  line: number;
  selector: string;
  ratio: number;
  threshold: number;
  fg: string;
  bg: string;
};

export type ContrastScan = {
  /** 面が不透明に確定して比を出せた対 */
  pairs: ContrastPair[];
  /** `color` は宣言されているのに面が確定せず、測れなかった宣言の数 */
  unmeasured: number;
};

type Context = {
  /** 不透明に確定した面。確定していなければ `null` */
  surface: Rgba | null;
  bgText: string;
  color: Rgba | null;
  colorText: string;
  /** rem。大きい文字の判定に使う */
  fontSize: number | null;
  bold: boolean;
  /** 継承する `opacity`。文字と面の両方に同じだけ掛かる */
  opacity: number;
};

const ROOT_CONTEXT: Context = {
  surface: null,
  bgText: "",
  color: null,
  colorText: "",
  fontSize: null,
  bold: false,
  opacity: 1,
};

function isDeclaration(node: ChildNode): node is Declaration {
  return node.type === "decl";
}

/** `1.3rem` / `13px` を rem に直す。`1rem = 10px`（`app/styles/global.scss`） */
function toRem(value: string, vars: Map<string, string>): number | null {
  const varMatch = value.trim().match(/^(?:[\w-]+\.)?(\$[\w-]+)$/);
  if (varMatch) {
    const referenced = vars.get(varMatch[1]);
    return referenced === undefined ? null : toRem(referenced, vars);
  }
  const m = value.trim().match(/^(-?\d*\.?\d+)(rem|px)$/);
  if (!m) return null;
  return m[2] === "rem" ? Number(m[1]) : Number(m[1]) / 10;
}

function isBoldValue(value: string): boolean {
  const v = value.trim();
  if (v === "bold" || v === "bolder") return true;
  const n = Number(v);
  return !Number.isNaN(n) && n >= 700;
}

function thresholdFor(ctx: Context): number {
  if (ctx.fontSize === null) return AA_NORMAL;
  if (ctx.fontSize >= 2.4) return AA_LARGE;
  if (ctx.fontSize >= 1.866 && ctx.bold) return AA_LARGE;
  return AA_NORMAL;
}

/**
 * 無効化された部品。WCAG 1.4.3 が本文の基準から外している。
 * 薄くして「押せない」を示すのが普通なので、測ると必ず落ちる
 */
function isDisabledState(node: Container): boolean {
  const selector = (node as { selector?: string }).selector ?? "";
  // `:not(:disabled)` は**有効なとき**の段。先に外さないと逆を拾う
  const withoutNot = selector.replace(/:not\([^)]*\)/g, "");
  return /:disabled|\[disabled\]|aria-disabled/.test(withoutNot);
}

/**
 * SCSS の入れ子のうち、DOM では同じ要素を指すもの（`&:hover` / `&.is-active` /
 * `&::before` / `&[disabled]`）。`&__x` や子孫セレクタは別の要素。
 *
 * `opacity` を親へ掛け合わせるか置き換えるかは、この判定だけで決まる
 */
function isSameElement(node: Container): boolean {
  const selector = (node as { selector?: string }).selector ?? "";
  return /^&[:.[]/.test(selector.trim());
}

function selectorOf(node: Container): string {
  const anyNode = node as { selector?: string; name?: string; params?: string };
  if (anyNode.selector) return anyNode.selector.replace(/\s+/g, " ");
  if (anyNode.name) return `@${anyNode.name} ${anyNode.params ?? ""}`.trim();
  return "";
}

function visit(node: Container, inherited: Context, vars: Map<string, string>, scan: ContrastScan) {
  const next: Context = { ...inherited };
  // 自分では何も宣言していない入れ子は、親と同じ対を繰り返すだけなので数えない
  let declaresPair = false;

  for (const child of node.nodes ?? []) {
    if (!isDeclaration(child)) continue;
    const prop = child.prop.toLowerCase();

    if (prop === "background" || prop === "background-color") {
      declaresPair = true;
      const parsed = resolveColor(child.value, vars);
      next.bgText = `${child.prop}: ${child.value}`;
      if (!parsed) {
        // グラデーションや解けない値。ここから下は面が分からない
        next.surface = null;
      } else if (parsed.a === 0) {
        // 透明。親の面がそのまま見える
        next.surface = inherited.surface;
        next.bgText = inherited.bgText;
      } else if (parsed.a === 1) {
        next.surface = parsed;
      } else {
        next.surface = inherited.surface ? composite(parsed, inherited.surface) : null;
      }
    }

    if (prop === "color") {
      declaresPair = true;
      const parsed = resolveColor(child.value, vars);
      next.color = parsed;
      next.colorText = `color: ${child.value}`;
    }

    if (prop === "font-size") next.fontSize = toRem(child.value, vars);
    if (prop === "font-weight") next.bold = isBoldValue(child.value);

    // 要素ごと薄くすると、文字も面も同じだけ**親の面**へ寄る。
    // 見ないと、静止 0.9 / ホバー 1.0 のボタンを実物より良い比で報告する。
    //
    // 擬似クラス・擬似要素の入れ子は同じ要素なので、掛けずに置き換える。
    // 掛けると `&:hover { opacity: 1 }` が「戻す」でなく「そのまま」になる
    if (prop === "opacity") {
      // 薄さは実効の比を動かす。宣言した規則は測り直す対象
      declaresPair = true;
      const value = Number(child.value.trim());
      if (!Number.isNaN(value)) {
        next.opacity = isSameElement(node) ? value : inherited.opacity * value;
      }
    }
  }

  if (declaresPair && next.colorText && !isDisabledState(node)) {
    // `opacity` は文字と面の両方を**親の面**へ寄せる。親が分からなければ測れない
    const fadesInto = next.opacity < 1 ? inherited.surface : next.surface;

    if (next.color && next.surface && fadesInto) {
      const fade = (color: Rgba) =>
        next.opacity < 1 ? composite({ ...color, a: next.opacity }, fadesInto) : color;

      const surface = fade(next.surface);
      const text = next.color.a < 1 ? composite(next.color, next.surface) : next.color;

      scan.pairs.push({
        line: node.source?.start?.line ?? 0,
        selector: selectorOf(node),
        ratio: contrastRatio(fade(text), surface),
        threshold: thresholdFor(next),
        fg: next.colorText,
        bg: next.bgText,
      });
    } else {
      // 面が決まらない、色が解けない（`currentColor` / `var()`）、
      // 薄めた先が分からない。**どれも「合格」ではない**ので数える
      scan.unmeasured += 1;
    }
  }

  for (const child of node.nodes ?? []) {
    if (child.type === "rule" || child.type === "atrule") {
      visit(child, next, vars, scan);
    }
  }
}

/**
 * 1ファイル分の走査。**測れた対と、測れなかった宣言の数の両方**を返す。
 *
 * 入れ子は継承として扱う。`&:hover { background: ... }` は親が宣言した
 * `color` の上に載るので、ホバーだけ基準を割る事故がここで見える。
 *
 * @param options.surface このファイルが載る面。渡すと最上位の面がそこから始まるので、
 *   自分では面を宣言しない部品（モーダルの中身など）も測れるようになる
 */
export function scanContrast(
  source: string,
  options: { vars: Map<string, string>; from?: string; surface?: Rgba } = { vars: new Map() },
): ContrastScan {
  const scan: ContrastScan = { pairs: [], unmeasured: 0 };
  const root = scss.parse(source, { from: options.from });
  const vars = collectVariables(source, new Map(options.vars));
  visit(root, { ...ROOT_CONTEXT, surface: options.surface ?? null }, vars, scan);
  return scan;
}
