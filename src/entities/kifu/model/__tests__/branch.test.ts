import { describe, expect, test } from "vitest";
import {
  MAIN_LINE,
  branchIndexAfterRemoval,
  branchIndexFromForkIndex,
  branchIndexFromSelection,
  forkIndexOrNull,
  branchLabel,
  forkIndexFromBranchIndex,
  neighborBranchIndex,
} from "../branch";

describe("branchIndexFromSelection", () => {
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

describe("forkIndexFromBranchIndex", () => {
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

describe("branchIndexFromForkIndex", () => {
  test("forks の添字は1ずれた位置になる", () => {
    expect(branchIndexFromForkIndex(0)).toBe(1);
    expect(branchIndexFromForkIndex(3)).toBe(4);
  });

  test("0以上の整数でなければ throw する", () => {
    // -1 を通すと MAIN_LINE に化け、範囲外の値が「本譜」として削除に渡る。
    for (const f of [-1, 0.5, NaN, Infinity]) {
      expect(() => branchIndexFromForkIndex(f)).toThrow();
    }
  });
});

describe("neighborBranchIndex", () => {
  test("一覧で1つ上/下に並ぶ位置", () => {
    expect(neighborBranchIndex(branchIndexFromForkIndex(1), "up")).toBe(1);
    expect(neighborBranchIndex(branchIndexFromForkIndex(1), "down")).toBe(3);
  });

  // 候補数を知らないので上限を見られない。範囲は編集の入口が throw で止める。
  test("一覧の端では範囲外の値を返す（検査しない）", () => {
    expect(neighborBranchIndex(MAIN_LINE, "up")).toBe(-1);
    expect(() => neighborBranchIndex(MAIN_LINE, "up")).not.toThrow();
  });
});

describe("branchIndexAfterRemoval", () => {
  test("自分より前が1つ消えた位置", () => {
    expect(branchIndexAfterRemoval(branchIndexFromForkIndex(2))).toBe(2);
  });

  // MAIN_LINE に対して呼ぶと MAIN_LINE 未満を返す。黙って本譜に化けないよう、
  // forkIndexFromBranchIndex が throw で止める。
  test("MAIN_LINE に対しては MAIN_LINE 未満を返し、変換側が throw する", () => {
    const below = branchIndexAfterRemoval(MAIN_LINE);
    expect(below).toBe(-1);
    expect(() => forkIndexFromBranchIndex(below)).toThrow();
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

describe("forkIndexOrNull", () => {
  // branchIndexFromSelection の逆。本譜と「変化0番」は BranchIndex では別物だが、
  // forkIndex では null と 0 になる。往復で潰れると削除・入れ替えの対象が1つずれる。
  test("本譜は null", () => {
    expect(forkIndexOrNull(MAIN_LINE)).toBeNull();
  });

  test("変化は0始まりの forkIndex に戻る", () => {
    expect(forkIndexOrNull(branchIndexFromSelection(0))).toBe(0);
    expect(forkIndexOrNull(branchIndexFromSelection(3))).toBe(3);
  });

  test("branchIndexFromSelection と往復しても値が変わらない", () => {
    for (const forkIndex of [null, 0, 1, 7]) {
      expect(forkIndexOrNull(branchIndexFromSelection(forkIndex))).toBe(forkIndex);
    }
  });
});
