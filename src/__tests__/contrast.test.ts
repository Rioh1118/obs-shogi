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

function scan(source: string) {
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

        &:disabled {
          opacity: 0.45;
        }
      }
    `);
    expect(findings.map((f) => f.selector)).toEqual([".a"]);
  });

  it("面が半透明のまま確定しなければ測らない", () => {
    expect(
      scan(`
        .a {
          background: rgba(index.$color-white, 0.06);
          color: rgba(index.$color-text-primary, 0.3);
        }
      `),
    ).toEqual([]);
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
