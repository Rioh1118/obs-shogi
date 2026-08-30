import { describe, expect, it } from "vitest";
import { collectVariables, composite, contrastRatio, resolveColor, scanContrast } from "./contrast";

/**
 * 走査器そのものの振る舞いを固定する。`contrastRatchet.test.ts` が
 * リポジトリ全体に掛けるので、ここが緩むと向こうの緑が意味を失う。
 */

const TOKENS = collectVariables(`
$color-primary-black: #1c2325;
$color-text-primary: #dcd7c9;
$color-white: #ffffff;
$stroke: rgba($color-white, 0.1);
`);

/** 基準を割った対だけ。走査そのものは測れた対を全部返す */
function scan(source: string) {
  return scanContrast(source, { vars: TOKENS }).pairs.filter((p) => p.ratio < p.threshold);
}

/** 配列の末尾。`Array.prototype.at` はこの tsconfig の lib に無い */
function last<T>(items: T[]): T {
  return items[items.length - 1];
}

/** 測れた対の全部。カバレッジを見るテストで使う */
function measured(source: string) {
  return scanContrast(source, { vars: TOKENS });
}

describe("色の解決", () => {
  it("トークンを名前空間ごと解く", () => {
    expect(resolveColor("index.$color-text-primary", TOKENS)).toEqual({
      r: 220,
      g: 215,
      b: 201,
      a: 1,
    });
  });

  it("トークンを参照するトークンを最後まで解く", () => {
    expect(resolveColor("index.$stroke", TOKENS)).toEqual({ r: 255, g: 255, b: 255, a: 0.1 });
  });

  it("color-mix の重みを片方の % から補う", () => {
    expect(resolveColor("color-mix(in srgb, #000000 25%, #ffffff)", TOKENS)).toEqual({
      r: 191.25,
      g: 191.25,
      b: 191.25,
      a: 1,
    });
  });

  it("解けない値は null にする。透明として数えない", () => {
    expect(resolveColor("linear-gradient(180deg, #000, #fff)", TOKENS)).toBeNull();
    expect(resolveColor("currentColor", TOKENS)).toBeNull();
    expect(resolveColor("var(--x)", TOKENS)).toBeNull();
  });
});

describe("比の計算", () => {
  it("白と黒が 21:1", () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(
      21,
      5,
    );
  });

  it("半透明の文字は面の上に重ねてから測る", () => {
    const surface = { r: 28, g: 35, b: 37, a: 1 };
    const text = { r: 220, g: 215, b: 201, a: 0.5 };
    expect(contrastRatio(composite(text, surface), surface)).toBeCloseTo(3.84, 1);
  });
});

describe("走査", () => {
  it("同じ規則の中の文字と面の対を測る", () => {
    const findings = scan(`
      .a {
        background: #1c2325;
        color: rgba(index.$color-text-primary, 0.5);
      }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].ratio).toBeCloseTo(3.84, 1);
  });

  it("入れ子で面だけを差し替えた段も測る", () => {
    const findings = scan(`
      .a {
        background: #1c2325;
        color: #ffffff;

        &:hover {
          background: #9e7757;
        }
      }
    `);
    // 親は 15.4:1 で通り、ホバーの段だけが落ちる
    expect(findings).toHaveLength(1);
    expect(findings[0].selector).toBe("&:hover");
    expect(findings[0].ratio).toBeCloseTo(4.02, 1);
  });

  it("自分では何も宣言していない入れ子は、親の対を繰り返さない", () => {
    const findings = scan(`
      .a {
        background: #1c2325;
        color: #5a5a5a;

        &:focus-visible {
          outline: 2px solid #fff;
        }
      }
    `);
    expect(findings.map((f) => f.selector)).toEqual([".a"]);
  });

  // WCAG は無効化された部品を本文の基準から外している
  it("disabled の段は測らない", () => {
    const findings = measured(`
      .a {
        background: #8f6b4e;
        color: #ffffff;

        &:disabled {
          opacity: 0.45;
        }
      }
    `).pairs;

    expect(findings.map((f) => f.selector)).toEqual([".a"]);
  });

  it("面が半透明のまま確定しなければ測らず、測れなかったことを数える", () => {
    const result = measured(`
      .a {
        background: rgba(index.$color-white, 0.06);
        color: rgba(index.$color-text-primary, 0.3);
      }
    `);

    expect(result.pairs).toEqual([]);
    // 「測れないから合格」を合格と数えない
    expect(result.unmeasured).toBe(1);
  });

  it("載る面を渡せば、自分では面を宣言しない部品も測れる", () => {
    const source = `
      .a {
        color: rgba(index.$color-text-primary, 0.3);
      }
    `;

    expect(measured(source).pairs).toHaveLength(0);
    expect(
      scanContrast(source, { vars: TOKENS, surface: { r: 28, g: 35, b: 37, a: 1 } }).pairs,
    ).toHaveLength(1);
  });

  it("要素ごとの opacity は、文字と面の両方を親の面へ寄せる", () => {
    const source = (extra: string) => `
      .parent {
        background: #1c2325;

        .a {
          background: #8f6b4e;
          color: #ffffff;
          ${extra}
        }
      }
    `;

    const opaque = last(measured(source("")).pairs);
    const faded = last(measured(source("opacity: 0.9;")).pairs);

    // 薄くすると実物の比は下がる。面側を寄せ忘れると、下がり方が足りない
    expect(faded.ratio).toBeLessThan(opaque.ratio);
    expect(faded.ratio).toBeCloseTo(4.44, 1);
  });

  // `&:hover` は同じ要素。掛けると「戻す」が「そのまま」になる
  it("擬似クラスの opacity は掛けずに置き換える", () => {
    const source = (extra: string) => `
      .parent {
        background: #1c2325;

        .a {
          background: #8f6b4e;
          color: #f5f5f5;
          ${extra}
        }
      }
    `;

    const plain = last(measured(source("")).pairs);
    const findings = measured(source("opacity: 0.5;\n          &:hover { opacity: 1; }")).pairs;

    const base = findings.find((f) => f.selector === ".a")!;
    const hover = findings.find((f) => f.selector === "&:hover")!;

    // ホバーは薄さが戻る。掛け算にすると 0.5 のままなので base と同じ比になる
    expect(base.ratio).toBeLessThan(hover.ratio);
    expect(hover.ratio).toBeCloseTo(plain.ratio, 5);
  });

  it("transparent は親の面をそのまま見せる", () => {
    const findings = scan(`
      .a {
        background: #1c2325;

        .b {
          background: transparent;
          color: rgba(index.$color-text-primary, 0.3);
        }
      }
    `);
    expect(findings).toHaveLength(1);
    expect(findings[0].selector).toBe(".b");
  });

  it("24px 以上の文字は 3:1 で通す", () => {
    const large = `
      .a {
        background: #1c2325;
        color: #757575;
        font-size: 2.4rem;
      }
    `;
    const normal = large.replace("2.4rem", "1.3rem");
    expect(scan(large)).toEqual([]);
    expect(scan(normal)).toHaveLength(1);
  });
});
