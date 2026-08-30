import { beforeEach, describe, expect, it } from "vitest";

import {
  branchGenerationOf,
  bumpBranchGeneration,
  resetBranchGenerations,
} from "../branchGeneration";

/**
 * 世代は「番号が動いた回数」。**棋譜ごとに数える。**
 *
 * 進める時刻を間違えると門番が一度も発火しない。実際に一度そうなった:
 * 書き込みが成功したあとに進める形にしたところ、`forks` はメモリ上で
 * `jkf_replaced` の時点で既に詰まっているのに世代は据え置きで、
 * その間に走った書き込みが**詰まった配列に、詰める前の番号**を当てていた。
 */
beforeEach(() => {
  resetBranchGenerations();
});

describe("分岐の番号の世代", () => {
  it("触っていない棋譜は 0 のまま", () => {
    expect(branchGenerationOf("/ws/a.kif")).toBe(0);
  });

  it("進めた棋譜だけが上がる", () => {
    bumpBranchGeneration("/ws/a.kif");
    expect(branchGenerationOf("/ws/a.kif")).toBe(1);
    expect(branchGenerationOf("/ws/b.kif")).toBe(0);
  });

  // 巻き戻しも「番号がもう一度動いた」。撃った時点で掴んだ値とは必ず食い違う
  it("進めるたびに上がる", () => {
    bumpBranchGeneration("/ws/a.kif");
    bumpBranchGeneration("/ws/a.kif");
    expect(branchGenerationOf("/ws/a.kif")).toBe(2);
  });

  // 保存先が決まっていない間の書き込みも同じ棋譜として数える
  it("null も1つの棋譜として数える", () => {
    bumpBranchGeneration(null);
    expect(branchGenerationOf(null)).toBe(1);
    expect(branchGenerationOf("/ws/a.kif")).toBe(0);
  });
});
