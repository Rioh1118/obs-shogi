import { describe, expect, test } from "vitest";
import {
  ROOT_CURSOR,
  cursorKey,
  forkIndexAt,
  makeKifuCursor,
  mergeBranchPlan,
  selectAt,
  truncateFrom,
  type ForkPointer,
  type KifuCursor,
} from "../cursor";

const fp = (te: number, forkIndex: number): ForkPointer => ({ te, forkIndex });

describe("selectAt", () => {
  test("te の選択を上書きする", () => {
    expect(selectAt([fp(2, 0), fp(4, 1)], 2, 3)).toEqual([fp(2, 3), fp(4, 1)]);
  });

  test("null は te の選択を消す（本譜を選ぶ）", () => {
    expect(selectAt([fp(2, 0), fp(4, 1)], 2, null)).toEqual([fp(4, 1)]);
  });

  // 0 は「変化の0番目」であって本譜ではない。取り違えると別の枝が選ばれる。
  test("forkIndex 0 は消さずに書き込む", () => {
    expect(selectAt([fp(2, 1)], 2, 0)).toEqual([fp(2, 0)]);
  });

  test("無い te に null を渡しても壊れない", () => {
    expect(selectAt([fp(2, 0)], 5, null)).toEqual([fp(2, 0)]);
  });

  test("返りは te 昇順", () => {
    expect(selectAt([fp(5, 0), fp(1, 0)], 3, 1)).toEqual([fp(1, 0), fp(3, 1), fp(5, 0)]);
  });
});

describe("forkIndexAt", () => {
  test("計画があればその forkIndex", () => {
    expect(forkIndexAt([fp(2, 1)], 2)).toBe(1);
  });

  test("forkIndex 0 は null にならない", () => {
    expect(forkIndexAt([fp(2, 0)], 2)).toBe(0);
  });

  test("計画が無ければ null（本譜）", () => {
    expect(forkIndexAt([fp(2, 0)], 3)).toBeNull();
  });
});

describe("truncateFrom", () => {
  test("te 以降を捨てる。te そのものも捨てる", () => {
    expect(truncateFrom([fp(1, 0), fp(3, 0), fp(5, 0)], 3)).toEqual([fp(1, 0)]);
  });
});

describe("selectAt の並び", () => {
  test("同じ te は上書きし、te 昇順で返す", () => {
    expect(selectAt([fp(3, 0), fp(1, 0)], 3, 2)).toEqual([fp(1, 0), fp(3, 2)]);
  });
});

describe("mergeBranchPlan", () => {
  const cursorAt = (tesuu: number, forkPointers: ForkPointer[]): KifuCursor => ({
    ...ROOT_CURSOR,
    tesuu,
    forkPointers,
  });

  // 不変条件1: te <= cursor.tesuu の範囲は cursor.forkPointers からしか取らない
  test("カーソル以下の範囲は cursor が勝ち、計画側は無視される", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [fp(2, 9)]);
    expect(merged).toEqual([fp(2, 0)]);
  });

  test("カーソルより先の計画は持ち越す", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [fp(5, 1)]);
    expect(merged).toEqual([fp(2, 0), fp(5, 1)]);
  });

  test("overridePlan もカーソルより先だけ効く", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [], [fp(1, 9), fp(6, 1)]);
    expect(merged).toEqual([fp(2, 0), fp(6, 1)]);
  });

  test("overridePlan は同じ te で prevPlan に勝つ", () => {
    const merged = mergeBranchPlan(cursorAt(1, []), [fp(4, 0)], [fp(4, 1)]);
    expect(merged).toEqual([fp(4, 1)]);
  });
});

describe("cursorKey", () => {
  const at = (tesuu: number, forkPointers: ForkPointer[]) => ({ tesuu, forkPointers });

  // 鍵は正規化を通す。通さないと同じ局面が並び順の違いで別の鍵になり、
  // コメント欄の開閉判定（KifuStreamList）と editorKey（KifuCommentNote）が外れる。
  test("並びが違うだけの forkPointers は同じ鍵", () => {
    expect(cursorKey(at(5, [fp(4, 1), fp(2, 0)]))).toBe(cursorKey(at(5, [fp(2, 0), fp(4, 1)])));
  });

  test("tesuu より先の選択は鍵に載らない", () => {
    expect(cursorKey(at(3, [fp(2, 0), fp(5, 1)]))).toBe(cursorKey(at(3, [fp(2, 0)])));
  });

  test("同じ te が重なれば後勝ちで1つに畳む", () => {
    expect(cursorKey(at(5, [fp(2, 0), fp(2, 1)]))).toBe(cursorKey(at(5, [fp(2, 1)])));
  });

  test("違う局面は違う鍵", () => {
    expect(cursorKey(at(5, [fp(2, 0)]))).not.toBe(cursorKey(at(5, [fp(2, 1)])));
    expect(cursorKey(at(5, []))).not.toBe(cursorKey(at(6, [])));
  });

  // 到達したかを確かめる側は、この鍵と再生器が返した tesuuPointer を突き合わせる。
  // 書式が揃っていないと比較そのものが成り立たない。
  test("再生器が返す tesuuPointer と同じ書式", () => {
    const observed = makeKifuCursor(5, [fp(2, 0)], `5,${JSON.stringify([fp(2, 0)])}`);
    expect(cursorKey(at(5, [fp(2, 0)]))).toBe(observed.tesuuPointer);
  });
});

describe("makeKifuCursor", () => {
  // 正規化はここが通す。呼び出し側（cursorFromPlayer）は player の生の値を渡す。
  test("forkPointers を te <= tesuu に正規化する", () => {
    const c = makeKifuCursor(3, [fp(5, 1), fp(2, 0)], "ignored");
    expect(c.forkPointers).toEqual([fp(2, 0)]);
  });

  test("同じ te が重なれば後勝ち", () => {
    expect(makeKifuCursor(5, [fp(2, 0), fp(2, 1)], "x").forkPointers).toEqual([fp(2, 1)]);
  });

  test("tesuuPointer は渡された文字列をそのまま持つ", () => {
    expect(makeKifuCursor(1, [], "5,[]").tesuuPointer).toBe("5,[]");
  });
});
