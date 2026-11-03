import { describe, expect, test } from "vitest";
import { placeBelowOrAbove, placeBeside } from "../popoverPlacement";

/**
 * 行の横と下に出す面の位置。
 *
 * 面が画面からはみ出すと、操作の項目が押せなくなる。横の面は行の高さに合わせて出るので、
 * 縦がずれると隣の行の操作に見える。
 */

const viewport = { width: 800, height: 600 };
const pop = { width: 100, height: 60 };

/** 左上の角と大きさから矩形を作る */
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  height,
});

describe("placeBeside", () => {
  test("入るなら右に出し、縦は行の中心に合わせる", () => {
    expect(placeBeside(rect(100, 200, 200, 20), pop, viewport)).toEqual({
      top: 180,
      left: 308,
      side: "right",
    });
  });

  test("右に入らなければ左へ反転する", () => {
    expect(placeBeside(rect(500, 200, 200, 20), pop, viewport)).toEqual({
      top: 180,
      left: 392,
      side: "left",
    });
  });

  test("右にちょうど入るなら反転しない", () => {
    // 右端は 600 + 8 + 100 = 708。余白の 8 を足して 716 が画面の幅に収まる
    expect(placeBeside(rect(400, 200, 200, 20), pop, { width: 716, height: 600 }).side).toBe(
      "right",
    );
    expect(placeBeside(rect(400, 200, 200, 20), pop, { width: 715, height: 600 }).side).toBe(
      "left",
    );
  });

  test("左へ反転しても入らなければ、画面の左端の余白へ寄せる", () => {
    expect(placeBeside(rect(20, 200, 760, 20), pop, viewport).left).toBe(8);
  });

  test("上下にはみ出すなら、画面の余白の内側へ寄せる", () => {
    expect(placeBeside(rect(100, 0, 200, 20), pop, viewport).top).toBe(8);
    expect(placeBeside(rect(100, 590, 200, 20), pop, viewport).top).toBe(532);
  });
});

describe("placeBelowOrAbove", () => {
  test("下に入るなら、右端を揃えて下に出す", () => {
    expect(placeBelowOrAbove(rect(300, 100, 20, 20), pop, viewport)).toEqual({
      top: 126,
      left: 220,
    });
  });

  test("下に入らず上に入るなら、上に出す", () => {
    expect(placeBelowOrAbove(rect(300, 540, 20, 20), pop, viewport)).toEqual({
      top: 474,
      left: 220,
    });
  });

  test("下の空きがちょうど足りるなら下に出す", () => {
    // 下の空きは 600 - 532 = 68 で、面の高さと余白の和と等しい
    expect(placeBelowOrAbove(rect(300, 512, 20, 20), pop, viewport).top).toBe(538);
    expect(placeBelowOrAbove(rect(300, 513, 20, 20), pop, viewport).top).toBe(447);
  });

  test("上にも下にも入らなければ、下に置いて画面の内側へ寄せる", () => {
    expect(placeBelowOrAbove(rect(300, 40, 20, 20), pop, { width: 800, height: 100 }).top).toBe(
      32,
    );
  });

  test("左にはみ出すなら、画面の左端の余白へ寄せる", () => {
    expect(placeBelowOrAbove(rect(10, 100, 20, 20), pop, viewport).left).toBe(8);
  });
});
