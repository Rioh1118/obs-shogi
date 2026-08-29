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
 * 覆わないことは幾何で保証してあるが、`top` を消す・`inset` で上書きする・
 * カードの高さを viewport 基準に戻す、のどれでも黙って壊れる。
 * happy-dom にはレイアウトエンジンが無く、`test.css` も切ってあるので
 * 実際の重なりは DOM では確かめられない。SCSS をコンパイルして値で見る。
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

/** セレクタが完全一致する規則の宣言。`.modal--light .modal__overlay` 等は含めない */
function declarationsOf(css: string, selector: string): Map<string, string> {
  const declarations = new Map<string, string>();
  postcss.parse(css).walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop, declaration.value);
    });
  });
  return declarations;
}

/** メディアクエリの中も含め、`.modal__card` に当たる規則の高さ指定を全て集める */
function cardHeights(css: string): { selector: string; text: string }[] {
  const found: { selector: string; text: string }[] = [];
  postcss.parse(css).walkRules((rule) => {
    if (!rule.selectors.some((selector) => selector.endsWith(".modal__card"))) return;
    rule.walkDecls(/^(max-)?height$/, (declaration) => {
      found.push({ selector: rule.selector, text: `${declaration.prop}: ${declaration.value}` });
    });
  });
  return found;
}

const modal = compile("shared/ui/Modal.scss");

describe("モーダルの overlay とタイトルバー", () => {
  const overlay = declarationsOf(modal, ".modal__overlay");
  const titlebar = declarationsOf(compile("shared/ui/TitleBar.scss"), ".titlebar");

  it("overlay の上端がタイトルバーの高さと一致する", () => {
    expect(
      overlay.get("top"),
      [
        "overlay はタイトルバーの帯を空けて描く。ここがずれると、",
        "小さければ帯を覆ってウィンドウが動かせなくなり（issue #53）、",
        "大きければ帯の下に何も描かれない隙間ができる。",
        "両方が同じトークン（$titlebar-height）を見ているか確かめること。",
      ].join("\n"),
    ).toBe(titlebar.get("height"));
  });

  it("overlay が inset で上端の指定を打ち消していない", () => {
    expect(
      overlay.has("inset"),
      "`inset` は `top` を含むので、後から書くと帯を空ける指定が消える",
    ).toBe(false);
  });

  it("overlay が上端以外の三辺を画面端に張っている", () => {
    expect(
      [overlay.get("right"), overlay.get("bottom"), overlay.get("left")],
      "上端だけを足して他の辺を落とすと、overlay が内容の大きさに縮む",
    ).toEqual(["0", "0", "0"]);
  });

  it("カードの高さが overlay の内容ボックスを超えない", () => {
    // `align-items: center` は不足分を上下対称にはみ出させるので、viewport 基準の
    // 高さを書くと overlay より低いことを無視してカードが帯の上に載る
    const unbounded = cardHeights(modal).filter(
      ({ text }) => !/100%|none|auto/.test(text.split(":")[1]),
    );

    expect(
      unbounded.map(({ selector, text }) => `${selector}  { ${text} }`),
      [
        "カードの高さは overlay の内容ボックス（100%）で挟むこと。",
        "`vh` だけで書くと overlay がタイトルバーの分だけ低いことを無視して、",
        "カードが上へはみ出して帯を覆い、下へはみ出して画面外に出る。",
      ].join("\n"),
    ).toEqual([]);
  });
});
