import { describe, expect, test } from "vitest";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import {
  MAIN_LINE,
  assertBranchIndex,
  branchIndexFromForkIndex,
  branchIndexFromSelection,
  forkIndexFromBranchIndex,
  neighborBranchIndex,
  type Candidates,
} from "../branch";

describe("BranchIndex を作る", () => {
  test("本譜の選択は MAIN_LINE", () => {
    expect(branchIndexFromSelection(null)).toBe(MAIN_LINE);
  });

  test("変化の添字は1ずれる", () => {
    expect(branchIndexFromSelection(0)).toBe(1);
    expect(branchIndexFromForkIndex(3)).toBe(4);
  });

  test("負の添字は throw する", () => {
    // -1 を通すと MAIN_LINE に化け、範囲外の値が「本譜」として削除に渡る。
    expect(() => branchIndexFromSelection(-1)).toThrow();
    expect(() => branchIndexFromForkIndex(-1)).toThrow();
  });

  test("整数でない添字は throw する", () => {
    expect(() => branchIndexFromForkIndex(0.5)).toThrow();
    expect(() => branchIndexFromForkIndex(NaN)).toThrow();
  });
});

describe("BranchIndex から forkIndex に戻す", () => {
  test("本譜は forks の外にいるので throw する", () => {
    expect(() => forkIndexFromBranchIndex(MAIN_LINE)).toThrow();
  });

  test("変化は1ずれた添字になる", () => {
    expect(forkIndexFromBranchIndex(branchIndexFromForkIndex(2))).toBe(2);
  });
});

describe("assertBranchIndex", () => {
  /** 本譜 + 変化2本ぶん。中身は長さしか見られないので空の手で足りる。 */
  const candidates = [[{}], [{}], [{}]] as IMoveFormat[][] as Candidates;

  test("候補の範囲に入っていれば通る", () => {
    expect(() => assertBranchIndex(MAIN_LINE, candidates)).not.toThrow();
    expect(() => assertBranchIndex(branchIndexFromForkIndex(1), candidates)).not.toThrow();
  });

  test("整数でない値は「範囲外」ではなく「整数でない」と言う", () => {
    // 0.5 は 0..2 の範囲内なので、範囲の側を疑わせない。
    // この2つは正規の変換では作れないので、brand を破って作る。
    expect(() => assertBranchIndex(0.5 as never, candidates)).toThrow(/not an integer/);
    expect(() => assertBranchIndex(NaN as never, candidates)).toThrow(/not an integer/);
  });

  test("候補数以上の値は範囲外", () => {
    expect(() => assertBranchIndex(branchIndexFromForkIndex(2), candidates)).toThrow(
      /out of range/,
    );
  });

  test("MAIN_LINE より小さい値は範囲外", () => {
    // 一覧の先頭で「上へ」を押したときに neighborBranchIndex が返す値がここで止まる。
    expect(() => assertBranchIndex(neighborBranchIndex(MAIN_LINE, "up"), candidates)).toThrow(
      /out of range/,
    );
  });
});
