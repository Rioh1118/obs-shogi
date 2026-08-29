import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
 * 見るのは**綴りでなく実効値**にしてある。`inset` は辺に展開してから比べるので、
 * 等価な書き換えは通り、テーマ別の規則（`.modal--dark .modal__overlay`）で
 * 上書きする改変は落ちる。
 */

const SRC = join(process.cwd(), "src");

/** `@use "@/index.scss"` を解決する。vite の alias はここには効かない */
const importer = {
  findFileUrl(url: string): URL | null {
    return url.startsWith("@/") ? pathToFileURL(join(SRC, url.slice(2))) : null;
  },
};

function compile(path: string): string {
  return sass.compile(join(SRC, path), { importers: [importer] }).css;
}

type Declaration = { selector: string; prop: string; value: string };

/**
 * 末尾の複合セレクタが `target` に当たる規則の宣言を、ソース順に全部集める。
 *
 * 完全一致で絞ると `.modal--dark .modal__overlay` のような詳細度で勝つ規則を
 * 見落とす。逆に緩すぎると `.modal__overlayXxx` を拾うので、語の境で止める
 */
function declarationsFor(css: string, target: string): Declaration[] {
  const pattern = new RegExp(`${target.replace(".", "\\.")}\\b`);
  const found: Declaration[] = [];
  postcss.parse(css).walkRules((rule) => {
    const matches = rule.selectors.some((selector) => {
      const compounds = selector.split(/[\s>+~]+/);
      return pattern.test(compounds[compounds.length - 1] ?? "");
    });
    if (!matches) return;
    rule.walkDecls((declaration) => {
      found.push({ selector: rule.selector, prop: declaration.prop, value: declaration.value });
    });
  });
  return found;
}

const EDGES = ["top", "right", "bottom", "left"] as const;
type Edge = (typeof EDGES)[number];

/** `inset` の 1〜4 値を辺に割り当てる。CSS の上・右・下・左の巡り方に従う */
function expandInset(value: string): Record<Edge, string> {
  const [a, b = a, c = a, d = b] = value.split(/\s+/);
  return { top: a, right: b, bottom: c, left: d };
}

/** 辺を決める宣言を、`inset` も展開したうえで出現順に並べる */
function edgeDeclarations(declarations: Declaration[]): {
  selector: string;
  edge: Edge;
  value: string;
}[] {
  return declarations.flatMap(({ selector, prop, value }) => {
    if (prop === "inset") {
      const expanded = expandInset(value);
      return EDGES.map((edge) => ({ selector, edge, value: expanded[edge] }));
    }
    return EDGES.some((edge) => edge === prop) ? [{ selector, edge: prop as Edge, value }] : [];
  });
}

/**
 * 高さの上限として許す形。`100%` を**含む**かどうかで見ると
 * `max(92vh, 100%)` や `calc(100% + 6rem)` が素通りするので、形を列挙する
 */
const BOUNDED_HEIGHT = /^(100%|auto|none|0)$|^min\(.+,\s*100%\)$/;

const modalCss = compile("shared/ui/Modal.scss");
const titlebarCss = compile("shared/ui/TitleBar.scss");

describe("モーダルの overlay とタイトルバー", () => {
  const titlebarHeights = declarationsFor(titlebarCss, ".titlebar")
    .filter(({ prop }) => prop === "height")
    .map(({ value }) => value);

  const overlayEdges = edgeDeclarations(declarationsFor(modalCss, ".modal__overlay"));

  it("タイトルバーの高さが1つに決まっている", () => {
    expect(
      [...new Set(titlebarHeights)],
      "帯の高さが規則によって違うと、overlay の上端をどれに合わせるべきか決まらない",
    ).toHaveLength(1);
  });

  it("overlay の上端がタイトルバーの高さと一致する", () => {
    const tops = overlayEdges.filter(({ edge }) => edge === "top");

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
    const others = overlayEdges.filter(({ edge }) => edge !== "top");

    expect(
      others.filter(({ value }) => value !== "0"),
      "上端だけを足して他の辺を落とすと、overlay が内容の大きさに縮む",
    ).toEqual([]);
    expect(
      [...new Set(others.map(({ edge }) => edge))].sort(),
      "三辺のうち指定が欠けているものがある",
    ).toEqual(["bottom", "left", "right"]);
  });

  it("カードの高さ指定が必ず 100% で挟まれている", () => {
    // `align-items: center` は不足分を上下対称にはみ出させるので、viewport 基準の
    // 高さを書くと overlay がタイトルバーの分だけ低いことを無視してカードが帯に載る。
    // `min-height` は `max-height` を上書きする（CSS 2.1 §10.7）ので同じ枠で見る
    const unbounded = declarationsFor(modalCss, ".modal__card")
      .filter(({ prop }) => /^(min-|max-)?height$/.test(prop))
      .filter(({ value }) => !BOUNDED_HEIGHT.test(value));

    expect(
      unbounded.map(({ selector, prop, value }) => `${selector} { ${prop}: ${value} }`),
      [
        "カードの高さは overlay の内容ボックス（100%）で挟むこと。",
        "`vh` だけで書くと overlay がタイトルバーの分だけ低いことを無視して、",
        "カードが上へはみ出して帯を覆い、下へはみ出して画面外に出る。",
        "許すのは `100%` / `auto` / `none` / `0` / `min(…, 100%)` の形だけ。",
        "`max(…, 100%)` や `calc(100% + …)` は 100% を含むが上限にならない。",
      ].join("\n"),
    ).toEqual([]);
  });
});
