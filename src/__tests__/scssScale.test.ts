import { describe, expect, it } from "vitest";
import { Bucket, scan } from "./scssScale";

function count(source: string, bucket: Bucket): number {
  return scan(source).filter((finding) => finding.bucket === bucket).length;
}

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
