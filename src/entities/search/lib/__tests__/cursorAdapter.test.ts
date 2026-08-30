import { describe, expect, test } from "vitest";
import { cursorFromLite } from "../cursorAdapter";

describe("cursorFromLite", () => {
  test("並び順が違うだけの入力は同じ経路になる", () => {
    const a = cursorFromLite({
      tesuu: 5,
      forkPointers: [
        { te: 3, forkIndex: 1 },
        { te: 1, forkIndex: 0 },
      ],
    });
    const b = cursorFromLite({
      tesuu: 5,
      forkPointers: [
        { te: 1, forkIndex: 0 },
        { te: 3, forkIndex: 1 },
      ],
    });

    expect(a).toEqual(b);
    expect(a.forkPointers).toEqual([
      { te: 1, forkIndex: 0 },
      { te: 3, forkIndex: 1 },
    ]);
  });

  // 索引のカーソルは辿った経路なので te > tesuu を含まないはずだが、
  // 壊れた索引を計画として扱わないよう入口で落とす。
  test("tesuu より先の pointer は落とす", () => {
    const c = cursorFromLite({
      tesuu: 2,
      forkPointers: [
        { te: 2, forkIndex: 0 },
        { te: 4, forkIndex: 1 },
      ],
    });

    expect(c.forkPointers).toEqual([{ te: 2, forkIndex: 0 }]);
  });

  test("tesuu はそのまま通す", () => {
    expect(cursorFromLite({ tesuu: 7, forkPointers: [{ te: 3, forkIndex: 0 }] }).tesuu).toBe(7);
  });
});
