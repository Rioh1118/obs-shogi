import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

/**
 * モーダルの overlay がタイトルバーの帯を覆わないことの検査。
 *
 * タイトルバーは `data-tauri-drag-region` を持ち、`decorations: false` の
 * ウィンドウを動かす唯一の手段になっている。ここが覆われると、モーダルを
 * 開いている間ウィンドウを動かせず、ウィンドウ操作ボタンも押せなくなる。
 *
 * この検査は node 環境で走る。DOM を作らないし、happy-dom を入れても
 * レイアウト計算が無いので重なりは再現できない。SCSS をコンパイルして値で見る。
 *
 * 見るのは**綴りでなく実効値**。`inset` 系は辺に展開してから比べ、高さの上限は
 * どの引数が上限になるかで判定するので、等価な書き換えは通る。
 *
 * 辺の検査だけは fail-closed にしてある。知らない `inset-*` 系に当たったら
 * 通さずに落とす。高さの検査はそうなっていない。見るのは
 * `src/features/**` の `height` / `min-height` だけで、モーダルの中身を
 * 別のレイヤに置いた場合や、`grid-template-rows` / `flex-basis` で
 * 高さを決めた場合は素通りする。
 *
 * 判定そのものは末尾の `describe("検査の判定")` で固定してある。
 */

/**
 * このファイル自身の位置から辿る。`process.cwd()` にすると、ランナーの起動場所が
 * 別の作業ツリーだったときにテスト本体とは違う木の SCSS を読み、
 * 何を検査したのかが起動場所で変わる
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** `@use "@/index.scss"` を解決する。vite の alias はここには効かない */
const importer = {
  findFileUrl(url: string): URL | null {
    return url.startsWith("@/") ? pathToFileURL(join(SRC, url.slice(2))) : null;
  },
};

function compile(path: string): string {
  return sass.compile(join(SRC, path), { importers: [importer] }).css;
}

/** 括弧の外にある `separator` だけで切る。関数の引数リストを壊さないため */
function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && separator.test(char)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * 結合子で切った最後の複合セレクタ。
 *
 * 単純な空白分割だと `:is(.modal__overlay, .other)` が最後の引数の断片に化ける。
 * sass はカンマの後に必ず空白を入れて出力するので、ソースで詰めても避けられない
 */
function lastCompound(selector: string): string {
  const parts = splitTopLevel(selector, /[\s>+~]/);
  return parts[parts.length - 1] ?? "";
}

type Declaration = { selector: string; prop: string; value: string; unconditional: boolean };

/**
 * 末尾の複合セレクタが `target` に当たる規則の宣言を、ソース順に全部集める。
 *
 * 完全一致で絞ると `.modal--dark .modal__overlay` のような詳細度で勝つ規則を
 * 見落とす。逆に緩すぎると `.modal__overlayXxx` を拾うので、語の境で止める
 */
function declarationsFor(css: string, target: string): Declaration[] {
  const pattern = new RegExp(`${target.replace(/\./g, "\\.")}\\b`);
  const found: Declaration[] = [];
  postcss.parse(css).walkRules((rule) => {
    const matches = rule.selectors.some((selector) => {
      const compound = lastCompound(selector);
      // 疑似要素は別の箱。`::after` の `top` も `::-webkit-scrollbar` の `height` も
      // 本体の幾何とは関係が無いのに、`\b` は `::` の前でも成立してしまう
      return !compound.includes("::") && pattern.test(compound);
    });
    if (!matches) return;
    rule.walkDecls((declaration) => {
      found.push({
        selector: rule.selector,
        prop: declaration.prop,
        value: declaration.value,
        unconditional: rule.parent?.type === "root",
      });
    });
  });
  return found;
}

const EDGES = ["top", "right", "bottom", "left"] as const;
type Edge = (typeof EDGES)[number];

/** `inset` の 1〜4 値を辺に割り当てる。CSS の上・右・下・左の巡り方に従う */
function expandInset(value: string): Partial<Record<Edge, string>> {
  const [a, b = a, c = a, d = b] = value.split(/\s+/);
  return { top: a, right: b, bottom: c, left: d };
}

/**
 * 論理プロパティから物理の辺へ。`index.html` は `lang="ja"` で
 * `writing-mode` の指定がどこにも無いため、`horizontal-tb` / `ltr` として対応させる
 */
const LOGICAL: Record<string, (value: string) => Partial<Record<Edge, string>>> = {
  "inset-block": (value) => {
    const [a, b = a] = value.split(/\s+/);
    return { top: a, bottom: b };
  },
  "inset-inline": (value) => {
    const [a, b = a] = value.split(/\s+/);
    return { left: a, right: b };
  },
  "inset-block-start": (value) => ({ top: value }),
  "inset-block-end": (value) => ({ bottom: value }),
  "inset-inline-start": (value) => ({ left: value }),
  "inset-inline-end": (value) => ({ right: value }),
};

/** 辺を決めうるのに展開規則を持っていないプロパティ。見つけたら通さない */
const EDGE_SHAPED = /^(inset|top|right|bottom|left)(-|$)/;

type EdgeSetting = { selector: string; edge: Edge; value: string };

function edgeSettings(declarations: Declaration[]): {
  settings: EdgeSetting[];
  unknown: string[];
} {
  const settings: EdgeSetting[] = [];
  const unknown: string[] = [];

  for (const { selector, prop, value } of declarations) {
    const expanded =
      prop === "inset"
        ? expandInset(value)
        : (LOGICAL[prop]?.(value) ??
          (EDGES.some((edge) => edge === prop) ? { [prop as Edge]: value } : undefined));

    if (expanded) {
      for (const edge of EDGES) {
        const set = expanded[edge];
        if (set !== undefined) settings.push({ selector, edge, value: set });
      }
    } else if (EDGE_SHAPED.test(prop)) {
      unknown.push(`${selector} { ${prop}: ${value} }`);
    }
  }
  return { settings, unknown };
}

/**
 * overlay の内容ボックスを超えない高さか。`100%` を**含む**かで見ると
 * `max(92vh, 100%)` や `calc(100% + 6rem)` が素通りし、引数の順序で見ると
 * `min(100%, 88vh)` のような正しい書き方を落とす。どれが上限になるかで判定する
 */
function isBounded(value: string): boolean {
  const text = value.trim();
  if (/^(100%|auto|0)$/.test(text)) return true;

  const call = /^(min|clamp)\((.*)\)$/s.exec(text);
  if (!call) return false;

  const args = splitTopLevel(call[2] ?? "", /,/).map((arg) => arg.trim());
  if (call[1] === "min") return args.includes("100%");
  // clamp(a, b, c) は max(a, min(b, c))。第3引数が `100%` でも、第1引数が
  // それを超えうるなら上限にならない（`clamp(32rem, 78vh, 100%)` は器を超える）
  return args.length === 3 && args[2] === "100%" && /^0(px|%|rem|em)?$/.test(args[0] ?? "");
}

/**
 * ビューポート基準の長さ。`vh` 系だけでなく `vw` / `vmin` / `vmax` も、
 * 高さに使えば同じく器と無関係に決まる。
 * `max-height` は要素を大きくできないので危なくない。器より大きくなりうるのは
 * `height` と `min-height` を viewport で決めた場合だけ
 */
const VIEWPORT_UNIT = /(?<![\w.])[\d.]+(?:d|s|l)?v(?:h|w|i|b|min|max)\b/;
const FORCING_HEIGHT = new Set(["height", "min-height"]);

function scssUnder(directory: string): string[] {
  return readdirSync(join(SRC, directory), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".scss"))
    .map((name) => join(directory, name));
}

/**
 * ビューポートで高さを決めていながら、器に対する頭打ちを持たない規則。
 *
 * モーダルの中身はカードの `overflow: hidden` の内側にいるので、カードを超えた分は
 * スクロールでも届かない。`Modal.scss` だけを見ていると、この故障は中身の側にあって
 * 検査に掛からない
 */
function unboundedIn(label: string, css: string): string[] {
  const found: string[] = [];
  {
    postcss.parse(css).walkRules((rule) => {
      const heights = rule.nodes.filter(
        (node): node is postcss.Declaration =>
          node.type === "decl" && /^(min-|max-)?height$/.test(node.prop),
      );
      const forcing = heights.filter(
        (declaration) =>
          FORCING_HEIGHT.has(declaration.prop) && VIEWPORT_UNIT.test(declaration.value),
      );
      if (forcing.length === 0) return;

      // 解決順は `max(min-height, min(max-height, height))` なので、`min-height` が
      // 器を超える値なら `max-height` では止まらない。`min-height: 0` は下限を
      // 外すだけで上限にはならない。`height: auto` も上限ではない
      const forcedFromBelow = forcing.some((declaration) => declaration.prop === "min-height");
      const bounded =
        !forcedFromBelow &&
        heights.some(
          (declaration) =>
            (declaration.prop === "max-height" ||
              (declaration.prop === "height" && declaration.value.trim() !== "auto")) &&
            isBounded(declaration.value),
        );
      if (bounded) return;

      for (const declaration of forcing) {
        found.push(`${label}  ${rule.selector} { ${declaration.prop}: ${declaration.value} }`);
      }
    });
  }
  return found;
}

function unboundedForcedHeights(paths: string[]): string[] {
  return paths.flatMap((path) => unboundedIn(path, compile(path)));
}

const modalCss = compile("shared/ui/Modal.scss");
const titlebarCss = compile("shared/ui/TitleBar.scss");

describe("モーダルの overlay とタイトルバー", () => {
  const titlebarHeights = declarationsFor(titlebarCss, ".titlebar")
    .filter(({ prop }) => prop === "height")
    .map(({ value }) => value);

  const overlay = edgeSettings(declarationsFor(modalCss, ".modal__overlay"));
  const cardDeclarations = declarationsFor(modalCss, ".modal__card");

  it("タイトルバーの高さが1つに決まっている", () => {
    expect(
      [...new Set(titlebarHeights)],
      "帯の高さが規則によって違うと、overlay の上端をどれに合わせるべきか決まらない",
    ).toHaveLength(1);
  });

  it("overlay の辺の指定が、この検査の知っている書き方だけでできている", () => {
    expect(
      overlay.unknown,
      [
        "辺を決めうるのに、この検査が辺へ展開できないプロパティがある。",
        "見落として緑になるのを避けるため落としている。",
        "展開規則を足すか、既知の書き方に戻すこと。",
      ].join("\n"),
    ).toEqual([]);
  });

  it("overlay の上端がタイトルバーの高さと一致する", () => {
    const tops = overlay.settings.filter(({ edge }) => edge === "top");

    expect(tops, "上端を決める宣言が1つも無い。overlay が帯を覆う").not.toHaveLength(0);
    expect(
      tops.map(({ selector, value }) => `${selector} { top: ${value} }`),
      [
        "overlay はタイトルバーの帯を空けて描く。ここがずれると、",
        "小さければ帯を覆ってウィンドウが動かせなくなり、",
        "大きければ帯の下に何も描かれない隙間ができる。",
        "両方が同じトークン（$titlebar-height）を見ているか確かめること。",
        `帯の高さ: ${titlebarHeights[0]}`,
      ].join("\n"),
    ).toEqual(tops.map(({ selector }) => `${selector} { top: ${titlebarHeights[0]} }`));
  });

  it("overlay が上端以外の三辺を画面端に張っている", () => {
    const others = overlay.settings.filter(({ edge }) => edge !== "top");

    expect(
      others.filter(({ value }) => value !== "0"),
      "上端だけを足して他の辺を落とすと、overlay が内容の大きさに縮む",
    ).toEqual([]);
    expect(
      [...new Set(others.map(({ edge }) => edge))].sort(),
      "三辺のうち指定が欠けているものがある",
    ).toEqual(["bottom", "left", "right"]);
  });

  it("カード自身が高さの上限を持っている", () => {
    // size 側のセレクタは詳細度で勝つので、書いてある size ではそちらが実効の
    // 上限になる。ここで見るのは、高さを書かない size が1つ増えたときの受け皿が
    // あること。無ければカードが内容の高さまで伸び、overlay を超えて帯に載る
    const base = cardDeclarations.filter(
      ({ selector, prop, unconditional }) =>
        selector === ".modal__card" && prop === "max-height" && unconditional,
    );

    expect(
      base.filter(({ value }) => isBounded(value)),
      [
        "`.modal__card` そのものに `max-height` の上限が無い。",
        "size ごとの規則に任せると、上限を書かない size が1つ増えた時点で破れる。",
      ].join("\n"),
    ).not.toHaveLength(0);
  });

  it("カードの高さ指定が必ず overlay の内容ボックスで頭打ちになる", () => {
    // `align-items: center` は不足分を上下対称にはみ出させるので、viewport 基準の
    // 高さを書くと overlay がタイトルバーの分だけ低いことを無視してカードが帯に載る。
    // `min-height` は `max-height` を上書きする（CSS 2.1 §10.7）ので同じ枠で見る
    const unbounded = cardDeclarations
      .filter(({ prop }) => /^(min-|max-)?height$/.test(prop))
      .filter(({ value }) => !isBounded(value));

    expect(
      unbounded.map(({ selector, prop, value }) => `${selector} { ${prop}: ${value} }`),
      [
        "カードの高さは overlay の内容ボックス（100%）で頭打ちにすること。",
        "`vh` だけで書くと overlay がタイトルバーの分だけ低いことを無視して、",
        "カードが上へはみ出して帯を覆い、下へはみ出して画面外に出る。",
        "`100%` / `auto` / `0`、`100%` を引数に持つ `min()`、",
        "第3引数が `100%` の `clamp()` が上限として効く。",
        "`max(…, 100%)` や `calc(100% + …)`、`none` は上限にならない。",
      ].join("\n"),
    ).toEqual([]);
  });

  it("モーダルの中身がビューポート基準で高さを決めていない", () => {
    // カードは overlay の内容ボックスで頭打ちになり、`overflow: hidden` で切る。
    // 中身がビューポート基準で高さを決めると短いウィンドウでカードを超え、
    // 超えた分（下端のフッタとそこに載るボタン）はスクロールでも届かなくなる。
    // Modal を使うのは `src/features/**` の10ファイルだけなのでそこを見る
    expect(
      unboundedForcedHeights(scssUnder("features")),
      [
        "モーダルの中身の高さは、ビューポートでなくカードを基準にすること。",
        "`height` / `min-height` を `vh` で決めるなら、同じ規則に",
        "`max-height: 100%` のような器に対する頭打ちを添える。",
        "`max-height` だけを `vh` で書くのは要素を大きくしないので対象外。",
      ].join("\n"),
    ).toEqual([]);
  });
});

/**
 * 判定そのものを固定する。上の検査は SCSS の現状に依存するので、
 * 判定を緩めても現状が通れば緑のままになる。ここが緩みを止める
 */
describe("検査の判定", () => {
  const boundedCases: [string, boolean][] = [
    ["100%", true],
    ["auto", true],
    ["min(88vh, 100%)", true],
    ["min(100%, 88vh)", true],
    ["min(88vh, 100%, 700px)", true],
    ["clamp(0px, 88vh, 100%)", true],
    // 第1引数が 100% を超えうるので上限にならない
    ["clamp(32rem, 78vh, 100%)", false],
    // `100%` を含むが上限にならない書き方
    ["max(92vh, 100%)", false],
    ["calc(100% + 6rem)", false],
    ["none", false],
    ["92vh", false],
  ];

  for (const [value, expected] of boundedCases) {
    it(`\`${value}\` を${expected ? "上限として認める" : "上限と認めない"}`, () => {
      expect(isBounded(value)).toBe(expected);
    });
  }

  const heightCases: [string, string, boolean][] = [
    ["viewport 基準の height に頭打ちがある", ".a { height: 78vh; max-height: 100%; }", false],
    ["頭打ちが無い", ".a { height: 78vh; }", true],
    // 解決順は max(min-height, min(max-height, height))
    ["min-height が viewport 基準", ".a { min-height: 60vh; max-height: 100%; }", true],
    ["height: auto は上限にならない", ".a { min-height: 78vh; height: auto; }", true],
    ["min-height: 0 は上限にならない", ".a { height: 78vh; min-height: 0; }", true],
    // 大きくしないので対象外
    ["max-height だけが viewport 基準", ".a { max-height: 34vh; }", false],
    ["vh 以外の viewport 単位", ".a { height: 70vmin; }", true],
    ["at-rule の内側でも見る", "@media (min-height: 1px) { .a { height: 78vh; } }", true],
  ];

  for (const [name, css, violates] of heightCases) {
    it(`${name}`, () => {
      expect(unboundedIn("case", css)).toHaveLength(violates ? 1 : 0);
    });
  }
});
