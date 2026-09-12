import { describe, expect, test } from "vitest";
import { boardSideForFrame } from "../boardSide";

/**
 * 盤の一辺は v0.3.0 から動かさない。**この表がその約束**。
 *
 * 値の出どころは v0.3.0 の実測（1280×800、`--board-pad` は下限の 8px に当たる）。
 * 枠の中に何かを足して一辺が動いたら、ここが落ちる。
 */

/** `--board-pad: clamp(8px, 0.6cqw, 12px)` の下限。幅 2000px 未満はここに当たる */
const PAD = 8;
/** 枠の4辺ぶん（呼び手は左右・上下を足して渡す） */
const FRAME_PAD = { x: PAD * 2, y: PAD * 2 };

describe("盤の一辺", () => {
  test("横長の枠は高さで決まる", () => {
    // 局面ナビゲーションの左ペイン（枠 651×422 の content box）
    expect(boardSideForFrame({ width: 651, height: 422 }, FRAME_PAD)).toBe(406);
  });

  test("縦長の枠は幅で決まる", () => {
    expect(boardSideForFrame({ width: 394, height: 480 }, FRAME_PAD)).toBe(378);
  });

  test("小さい枠でも 240 は下回らない", () => {
    // 下回らせると盤が読めなくなる。枠からはみ出す側を選んでいる
    expect(boardSideForFrame({ width: 200, height: 200 }, FRAME_PAD)).toBe(240);
  });

  test("広い枠でも 820 を超えない", () => {
    expect(boardSideForFrame({ width: 2000, height: 2000 }, FRAME_PAD)).toBe(820);
  });

  test("端数は切り捨てる", () => {
    // 盤は升を整数で割る。切り上げると最後の1筋が枠から出る
    expect(boardSideForFrame({ width: 400.9, height: 500 }, FRAME_PAD)).toBe(384);
  });

  test("枠の高さが盤で決まる面では、下限へ落ちて止まる", () => {
    // `SfenKifuCreateModal` の `__preview` は高さを持たない flex なので、
    // 枠が盤に合わせて縮み、縮んだ枠をまた測る。余白を2度引く形がここで効く。
    // **止まること**（発散も振動もしない）が、この面の出荷時の見た目
    let side = 320;
    for (let i = 0; i < 20; i++) {
      side = boardSideForFrame({ width: side, height: side }, FRAME_PAD);
    }
    expect(side).toBe(240);
  });
});
