import { describe, expect, test } from "vitest";
import { cursorFromLite } from "../cursorAdapter";
import { buildTesuuPointer } from "@/entities/kifu/model/branch";

describe("cursorFromLite", () => {
  test("並び順が違うだけの入力は同じ tesuuPointer になる", () => {
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

    expect(a.tesuuPointer).toBe(b.tesuuPointer);
    expect(a.forkPointers).toEqual([
      { te: 1, forkIndex: 0 },
      { te: 3, forkIndex: 1 },
    ]);
  });

  test("tesuu より先の pointer は落とす", () => {
    const c = cursorFromLite({
      tesuu: 2,
      forkPointers: [
        { te: 2, forkIndex: 0 },
        { te: 4, forkIndex: 1 },
      ],
    });

    expect(c.forkPointers).toEqual([{ te: 2, forkIndex: 0 }]);
    expect(c.tesuuPointer).toBe(buildTesuuPointer(2, [{ te: 2, forkIndex: 0 }]));
  });

  test("tesuuPointer は buildTesuuPointer が組むものと一致する", () => {
    const c = cursorFromLite({ tesuu: 7, forkPointers: [{ te: 3, forkIndex: 0 }] });

    expect(c.tesuuPointer).toBe(buildTesuuPointer(7, [{ te: 3, forkIndex: 0 }]));
  });
});
