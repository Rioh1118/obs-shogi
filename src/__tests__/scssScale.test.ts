import { describe, expect, it } from "vitest";
import type { Bucket } from "./scssScale";
import { scan } from "./scssScale";

function count(source: string, bucket: Bucket): number {
  return scan(source).filter((finding) => finding.bucket === bucket).length;
}

describe("所見の位置", () => {
  it("宣言のある行を指す", () => {
    const source = ".a {\n  color: red;\n  font-size: 1.37rem;\n}";
    expect(scan(source)).toEqual([{ bucket: "font-size", line: 3, text: "font-size: 1.37rem;" }]);
  });

  it("折り返した宣言はプロパティ名のある行を指す", () => {
    const source = ".a {\n  padding:\n    1.37rem\n    2.11rem;\n}";
    expect(scan(source)[0].line).toBe(2);
  });
});

describe("トークンを定義するファイル", () => {
  const tokens = "$font-body: 1.3rem;\n$space-1: 0.2rem;";

  it("既定では変数の定義も数える", () => {
    expect(count(tokens, "indirect")).toBe(2);
  });

  it("tokenSource なら数えない", () => {
    expect(scan(tokens, { tokenSource: true }).filter((f) => f.bucket === "indirect")).toEqual([]);
  });
});

describe("宣言の切り出し", () => {
  it("1行に収まった宣言を拾う", () => {
    expect(count(".a { font-size: 1.37rem; }", "font-size")).toBe(1);
  });

  it("セミコロンが無い最後の宣言を拾う", () => {
    expect(count(".a { font-size: 1.37rem }", "font-size")).toBe(1);
  });

  it("大文字のプロパティ名を拾う", () => {
    expect(count(".a { FONT-SIZE: 1.37rem; }", "font-size")).toBe(1);
  });

  it("1行に2つ並べた宣言を両方拾う", () => {
    expect(scan(".a { font-size: 1.37rem; border-radius: 0.77rem; }")).toHaveLength(2);
  });

  it("値が次の行に折り返された宣言を拾う", () => {
    expect(count(".a {\n  padding:\n    1.37rem 2.11rem;\n}", "spacing")).toBe(1);
  });

  it("ネストした1行ブロックの中を拾う", () => {
    expect(count(".a { &:hover { border-radius: 0.77rem; } }", "border-radius")).toBe(1);
  });

  it("値に : を含む Sass マップを拾う", () => {
    expect(count("$sizes: (sm: 0.4rem, md: 1.37rem);", "indirect")).toBe(1);
  });
});

describe("コメントと文字列", () => {
  it("コメントの直後の宣言を落とさない", () => {
    expect(count(".a {\n  // 説明: なにか\n  font-size: 1.37rem;\n}", "font-size")).toBe(1);
  });

  it("コメントの中の宣言は数えない", () => {
    expect(count(".a { /* font-size: 1.37rem; */ }", "font-size")).toBe(0);
  });

  it("url() の中の // で行が消えない", () => {
    const source = ".a { background-image: url(https://x.test/a.png); padding: 1.37rem; }";
    expect(count(source, "spacing")).toBe(1);
  });

  it("文字列の中の記号で宣言が壊れない", () => {
    expect(count('.a { content: "a;b{c}"; padding: 1.37rem; }', "spacing")).toBe(1);
  });

  it("エスケープされた引用符の後の宣言を落とさない", () => {
    expect(count('.a { content: "\\""; padding: 1.37rem; }', "spacing")).toBe(1);
  });

  it("コメントの中の @include は数えない", () => {
    expect(count(".a {\n  // @include size(1.37rem);\n}", "indirect")).toBe(0);
    expect(count(".a { /* @include size(1.37rem); */ }", "indirect")).toBe(0);
  });
});

describe("Sass の構文", () => {
  it("補間を含む宣言でも、同じ宣言の直値を見失わない", () => {
    expect(count(".a { padding: #{$x} 1.37rem; }", "spacing")).toBe(1);
  });

  it("補間そのものは直値ではない", () => {
    expect(count(".a { font-size: calc(100cqw / #{$unit}); }", "font-size")).toBe(0);
  });

  it("@media の中の宣言を数える", () => {
    const source = "@media (min-width: 640px) {\n  .a { padding: 1.37rem; }\n}";
    expect(count(source, "spacing")).toBe(1);
  });

  it("@media の条件は宣言ではない", () => {
    expect(count("@media (min-width: 640px) { .a { color: red; } }", "spacing")).toBe(0);
  });

  it("@each の中の宣言を数える", () => {
    const source = "@each $n in a, b {\n  .#{$n} { padding: 1.37rem; }\n}";
    expect(count(source, "spacing")).toBe(1);
  });

  it("@if / @else の中の宣言を数える", () => {
    const source = "@mixin m($x) {\n  @if $x { padding: 1.37rem; } @else { margin: 2.11rem; }\n}";
    expect(count(source, "spacing")).toBe(2);
  });
});

describe("トークン参照", () => {
  it("トークンだけの宣言は数えない", () => {
    expect(count(".a { padding: index.$space-2; }", "spacing")).toBe(0);
  });

  it("トークンと直値が混ざった宣言を数える", () => {
    expect(count(".a { padding: index.$space-2 1.37rem; }", "spacing")).toBe(1);
  });

  it("var() と直値が混ざった宣言を数える", () => {
    expect(count(".a { padding: 0.25rem var(--pane-px) 0.4rem; }", "spacing")).toBe(1);
  });

  it("単位の無い 0 は数えない", () => {
    expect(count(".a { padding: 0; }", "spacing")).toBe(0);
  });

  it("負の寸法を数える", () => {
    expect(count(".a { margin: -0.2rem; }", "spacing")).toBe(1);
  });
});

describe("mixin の引数", () => {
  it("引数の直値を数える", () => {
    expect(count(".a { @include size(1.37rem); }", "indirect")).toBe(1);
  });

  it("引数がトークンだけなら数えない", () => {
    expect(count(".a { @include size(index.$space-2); }", "indirect")).toBe(0);
  });

  it("入れ子の関数を第1引数に置いても、後続の直値を見失わない", () => {
    const source = ".a { @include size(rgba(0, 0, 0, 0.5), 1.37rem); }";
    expect(count(source, "indirect")).toBe(1);
  });
});

describe("モーション", () => {
  it("トランジションの直値を数える", () => {
    expect(count(".a { transition: opacity 120ms ease; }", "motion")).toBe(1);
  });

  it("反復しない秒単位のトランジションも数える", () => {
    expect(count(".a { transition: width 1s ease; }", "motion")).toBe(1);
  });

  it("反復するアニメーションは寄せ先が無いので数えない", () => {
    expect(count(".a { animation: spin 1.5s linear infinite; }", "motion")).toBe(0);
  });

  it("反復しないアニメーションは数える", () => {
    expect(count(".a { animation: fadeIn 0.6s ease; }", "motion")).toBe(1);
  });
});

describe("除外の印", () => {
  it("印の付いた宣言は exempt に移る", () => {
    const source = ".a { font-size: 1.37rem; // scale-exempt\n}";
    expect(count(source, "font-size")).toBe(0);
    expect(count(source, "exempt")).toBe(1);
  });

  it("折り返した宣言では値の行に印を書いても効く", () => {
    const source = ".a {\n  transition:\n    width 77ms ease; // scale-exempt\n}";
    expect(count(source, "exempt")).toBe(1);
  });

  it("mixin の引数にも印が効く", () => {
    const source = ".a { @include size(1.37rem); // scale-exempt\n}";
    expect(count(source, "indirect")).toBe(0);
    expect(count(source, "exempt")).toBe(1);
  });

  it("複数行の値の途中に紛れた別の宣言の印を拾わない", () => {
    const source = [
      ".a {",
      "  box-shadow:",
      "    0 1px 2px rgba(0, 0, 0, 0.2),",
      "    0 2px 4px rgba(0, 0, 0, 0.1); font-size: 1.2rem; // scale-exempt",
      "}",
    ].join("\n");
    expect(count(source, "elevation")).toBe(1);
    expect(count(source, "exempt")).toBe(1);
  });
});

describe("角丸", () => {
  it("pill を数える", () => {
    expect(count(".a { border-radius: 999px; }", "border-radius")).toBe(1);
  });

  it("円を数える", () => {
    expect(count(".a { border-radius: 50%; }", "border-radius")).toBe(1);
  });

  it("角丸以外の % は数えない", () => {
    expect(count(".a { padding: 50%; }", "spacing")).toBe(0);
  });
});

describe("等幅フォント", () => {
  it("フォントスタックの直書きを数える", () => {
    const source = '.a { font-family: ui-monospace, Menlo, "Courier New", monospace; }';
    expect(count(source, "family")).toBe(1);
  });

  it("トークンを参照していれば数えない", () => {
    expect(count(".a { font-family: index.$font-mono; }", "family")).toBe(0);
  });

  it("継承と単一の総称名は数えない", () => {
    expect(count(".a { font-family: inherit; }", "family")).toBe(0);
    expect(count(".a { font-family: sans-serif; }", "family")).toBe(0);
  });
});

describe("at-rule へ逃がした寸法", () => {
  it("mixin の既定値を数える", () => {
    expect(count("@mixin card($pad: 1.37rem) { padding: $pad; }", "indirect")).toBe(1);
  });

  it("@return の直値を数える", () => {
    expect(count("@function gap() { @return 1.37rem; }", "indirect")).toBe(1);
  });

  it("@each のマップの直値を数える", () => {
    const source = "@each $n, $v in (sm: 1.37rem) { .c-#{$n} { padding: $v; } }";
    expect(count(source, "indirect")).toBe(1);
  });

  it("@use with の設定値を数える", () => {
    expect(count('@use "./t" with ($gap: 1.37rem);', "indirect")).toBe(1);
  });

  it("@media の条件は寸法ではないので数えない", () => {
    expect(count("@media (min-width: 640px) { .a { color: red; } }", "indirect")).toBe(0);
  });
});
