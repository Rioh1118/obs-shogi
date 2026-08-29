import { describe, expect, test } from "vitest";
import {
  MAIN_LINE,
  branchIndexFromForkIndex,
  branchIndexFromSelection,
  branchLabel,
  forkIndexFromBranchIndex,
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

  test("整数でない値も throw する（作る側と同じ値域を弾く）", () => {
    // 片側だけ検査があると、非整数が forkIndex として ForkPointer に残り、
    // 遠くの resolveLine で表に出る。
    for (const b of [0.5, NaN, Infinity, -1]) {
      expect(() => forkIndexFromBranchIndex(b as never)).toThrow();
      expect(() => branchIndexFromForkIndex(b)).toThrow();
    }
  });
});

describe("branchLabel", () => {
  test("番号は forkIndex から作り、BranchIndex と一致する", () => {
    expect(branchLabel()).toBe("本譜");
    expect(branchLabel(0)).toBe(`変化${branchIndexFromForkIndex(0)}`);
    expect(branchLabel(2)).toBe(`変化${branchIndexFromForkIndex(2)}`);
  });

  test("壊れた forkIndex でも throw しない", () => {
    // レンダ中に呼ばれるので、ラベル1つのために画面を落とさない。
    // 値の検査は編集の入口が行う。
    for (const f of [-1, 0.5, NaN]) {
      expect(() => branchLabel(f)).not.toThrow();
    }
  });
});
