import { describe, expect, it } from "vitest";

import { createCandidateCache } from "../candidateCache";
import type { AnalysisCandidate } from "@/entities/engine";

const candidate = (rank: number): AnalysisCandidate => ({ rank, pv_line: [] });

describe("候補手の控え", () => {
  it("覚えた候補手を同じ鍵で引ける", () => {
    const cache = createCandidateCache();

    cache.remember("k1", [candidate(1), candidate(2)]);

    expect(cache.lookup("k1")).toEqual([candidate(1), candidate(2)]);
  });

  it("覚えていない鍵は空", () => {
    const cache = createCandidateCache();

    cache.remember("k1", [candidate(1)]);

    expect(cache.lookup("k2")).toEqual([]);
  });

  /**
   * 鍵が定まらないのは棋譜を開いていないか局面が決まっていないとき。
   * 「鍵が無い」を「覚えていない」と別扱いすると、呼ぶ側が毎回 null を弾く必要が出る。
   */
  it("鍵が null なら空", () => {
    const cache = createCandidateCache();

    cache.remember("k1", [candidate(1)]);

    expect(cache.lookup(null)).toEqual([]);
  });

  it("違う棋譜を宣言すると全て捨てる", () => {
    const cache = createCandidateCache();
    cache.scopeTo("file-a");
    cache.remember("k1", [candidate(1)]);

    cache.scopeTo("file-b");

    expect(cache.lookup("k1")).toEqual([]);
  });

  /**
   * **同じ棋譜の宣言で捨ててはいけない。** 宣言するのは画面側で、画面が作り直されると
   * 「前に何を宣言したか」を忘れて最初から宣言し直す。捨ててしまうと、控えを
   * 画面の外へ出した意味が無くなる（持ち主だけ替わって、消えるのは同じ）。
   * 覚えているのは控えの側。
   */
  it("同じ棋譜を宣言し直しても捨てない", () => {
    const cache = createCandidateCache();
    cache.scopeTo("file-a");
    cache.remember("k1", [candidate(1)]);

    cache.scopeTo("file-a");

    expect(cache.lookup("k1")).toEqual([candidate(1)]);
  });

  it("同じ鍵に覚え直すと新しい方が出る", () => {
    const cache = createCandidateCache();

    cache.remember("k1", [candidate(1)]);
    cache.remember("k1", [candidate(3)]);

    expect(cache.lookup("k1")).toEqual([candidate(3)]);
  });
});
