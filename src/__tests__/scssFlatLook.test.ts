import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Declaration, Rule } from "postcss";
import scss from "postcss-scss";
import { describe, expect, it } from "vitest";
import { SRC, scssFiles } from "./walk";

/**
 * 画面の形を、見出し・行・線だけに保つ（`design-system/decisions/0005`）。
 *
 * 止めるのは、作り直す前の画面に散っていて、目で見ても1つずつは小さく見えるもの。
 * グラデーション・ぼかし・角丸の箱の片側の棒・番号で選んだ角・重なりでも盤でもない影。
 *
 * **文字のはみ出し、箱の入れ子、色の比はここでは見えない。** 描かれた画面を測る
 * `npm --prefix design-system run ds:screens -- --strict` が見る。
 */

/** 角は役割で選ぶ */
const RADIUS = /^(0|inherit|(index\.)?\$radius-(row|control|surface|modal|circle))$/;

/** 影を落とすのは、重なるものと、盤と駒台。`$marker-bar` は影でなく表の行の線 */
const SHADOW = /^(none|(index\.)?\$(shadow-overlay|shadow-board|marker-bar|marker-bar-end))$/;

/** 盤の上の物。木と駒は物なので、縁と浮きを影で描いてよい */
const ON_BOARD = new Set([
  "features/position-editor/ui/PositionEditor.scss",
  "widgets/game-board/ui/Hand.scss",
  "widgets/game-board/ui/Square.scss",
]);

/** 局面の「いま」を示す左の線（`design-system/design_system/patterns/selection.md`） */
const NOW_LINE = "2px solid index.$color-secondary-dark";

const ONE_SIDED = /^border-(left|right|inline-start|inline-end)$/;

/** 線の太さ（px）。`rem` は 10px（`global.scss` の `html`） */
function thickness(value: string): number {
  const length = /(\d*\.?\d+)(px|rem)\b/.exec(value);
  if (!length) return 0;
  return Number(length[1]) * (length[2] === "rem" ? 10 : 1);
}

/** 同じ規則が角を丸めているか。行（`$radius-row`）は丸めない */
function isRounded(rule: Rule): boolean {
  return rule.nodes.some(
    (node) =>
      node.type === "decl" &&
      /^border(-[a-z]+)*-radius$/.test(node.prop) &&
      !/^(0|index\.\$radius-row)$/.test(node.value.trim()),
  );
}

function reasonOf(decl: Declaration, file: string): string | null {
  const prop = decl.prop.toLowerCase();
  const value = decl.value.trim();

  // 送る一覧の下端を薄くするのは、塗りでなく切り抜き（`index.scss` の `scroll-more`）
  if (value.includes("gradient(") && !prop.includes("mask")) return "グラデーション";
  if (prop.endsWith("backdrop-filter") || value.includes("blur(")) return "ぼかし";
  if (prop === "text-shadow") return "文字の影";
  if (prop === "box-shadow" && !SHADOW.test(value) && !ON_BOARD.has(file)) return "影";
  if (value.includes("drop-shadow(") && !ON_BOARD.has(file)) return "影";
  if (/^border(-[a-z]+)*-radius$/.test(prop) && !RADIUS.test(value)) return "役割で選んでいない角";

  if (ONE_SIDED.test(prop) && thickness(value) >= 2 && decl.parent?.type === "rule") {
    if (value !== NOW_LINE) return "片側の棒";
    if (isRounded(decl.parent as Rule)) return "丸めた箱の片側の棒";
  }
  return null;
}

function offences(file: string, css: string): string[] {
  const found: string[] = [];
  scss.parse(css).walkDecls((decl) => {
    // 変数の値は、使う所で見る
    if (decl.prop.startsWith("$")) return;
    const reason = reasonOf(decl, file);
    if (reason) found.push(`${file}  ${reason}: ${decl.prop}: ${decl.value}`);
  });
  return found;
}

describe("SCSS の形", () => {
  const files = scssFiles(SRC);

  it("走査が0件になっていない", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("グラデーション・ぼかし・片側の棒・役割で選んでいない角と影を書かない", () => {
    const found = files.flatMap((path) =>
      offences(relative(SRC, path).replace(/\\/g, "/"), readFileSync(path, "utf8")),
    );

    expect(
      found,
      [
        "画面は、見出し・行・線だけで組む（design-system/decisions/0005）。",
        "選んだものは灰青と太字、局面の「いま」は左の銅の線2px、浮くものは $shadow-overlay。",
        "角は $radius-row / control / surface / modal / circle から役割で選ぶ。",
      ].join("\n"),
    ).toEqual([]);
  });
});

/**
 * 判定そのものを固定する。上の検査は現状の SCSS に依存するので、
 * 判定を緩めても現状が通れば緑のままになる
 */
describe("判定", () => {
  const cases: [string, string, string | null][] = [
    ["グラデーション", ".a { background: linear-gradient(#000, #fff); }", "グラデーション"],
    ["切り抜きのグラデーション", ".a { mask-image: linear-gradient(#000, transparent); }", null],
    ["ぼかし", ".a { backdrop-filter: blur(8px); }", "ぼかし"],
    ["効果のぼかし", ".a { filter: blur(2px); }", "ぼかし"],
    ["文字の影", ".a { text-shadow: 0 1px #000; }", "文字の影"],
    ["書き下ろした影", ".a { box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); }", "影"],
    ["重なりの影", ".a { box-shadow: index.$shadow-overlay; }", null],
    ["絵の影", ".a { filter: drop-shadow(0 2px 4px #000); }", "影"],
    ["番号で選んだ角", ".a { border-radius: index.$radius-4; }", "役割で選んでいない角"],
    ["書き下ろした角", ".a { border-radius: 8px; }", "役割で選んでいない角"],
    ["1か所だけの角", ".a { border-top-left-radius: 8px; }", "役割で選んでいない角"],
    ["役割の角", ".a { border-radius: index.$radius-control; }", null],
    ["片側の棒", ".a { border-left: 3px solid index.$color-danger; }", "片側の棒"],
    ["rem の片側の棒", ".a { border-inline-start: 0.4rem solid red; }", "片側の棒"],
    ["境の線", ".a { border-left: 1px solid index.$stroke-weak; }", null],
    ["いまの線", `.a { border-left: ${NOW_LINE}; }`, null],
    [
      "丸めた箱のいまの線",
      `.a { border-radius: index.$radius-surface; border-left: ${NOW_LINE}; }`,
      "丸めた箱の片側の棒",
    ],
    ["行のいまの線", `.a { border-radius: index.$radius-row; border-left: ${NOW_LINE}; }`, null],
    ["変数の値", "$a: linear-gradient(#000, #fff);", null],
  ];

  for (const [name, css, reason] of cases) {
    it(`${name}を${reason ? "止める" : "通す"}`, () => {
      const found = offences("case.scss", css);
      expect(found).toHaveLength(reason ? 1 : 0);
      if (reason) expect(found[0]).toContain(reason);
    });
  }

  it("盤の上の物だけは、影で描いてよい", () => {
    const css = ".a { box-shadow: inset 0 0 0 1px #000; filter: drop-shadow(0 2px #000); }";
    expect(offences("widgets/game-board/ui/Square.scss", css)).toEqual([]);
    expect(offences("widgets/dock/ui/Dock.scss", css)).toHaveLength(2);
  });
});
