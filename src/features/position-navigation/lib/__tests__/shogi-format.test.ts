import { describe, expect, test } from "vitest";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color } from "shogi.js";
import { formatMove } from "../shogi-format";

const GI_FROM_78_TO_77: IMoveMoveFormat = {
  from: { x: 7, y: 8 },
  to: { x: 7, y: 7 },
  piece: "GI",
  color: Color.Black,
};

/** relative が付くのは同じ地点に行ける駒が複数あるときなので、from は本質でない */
function withRelative(relative: string): IMoveMoveFormat {
  return { ...GI_FROM_78_TO_77, relative };
}

describe("formatMove", () => {
  test("手が無ければ空文字", () => {
    expect(formatMove(undefined)).toBe("");
  });

  test("移動先と駒を繋げる", () => {
    expect(formatMove(GI_FROM_78_TO_77)).toBe("☗7七銀");
  });

  test("same なら移動先の代わりに「同」", () => {
    expect(formatMove({ ...GI_FROM_78_TO_77, same: true })).toBe("☗同銀");
  });

  test("promote なら末尾に「成」", () => {
    const move: IMoveMoveFormat = {
      from: { x: 8, y: 8 },
      to: { x: 2, y: 2 },
      piece: "KA",
      color: Color.Black,
      promote: true,
    };
    expect(formatMove(move)).toBe("☗2二角成");
  });

  describe("手番", () => {
    test("先手は ☗", () => {
      expect(formatMove(GI_FROM_78_TO_77).startsWith("☗")).toBe(true);
    });

    test("後手は ☖", () => {
      const white: IMoveMoveFormat = { ...GI_FROM_78_TO_77, color: Color.White };
      expect(formatMove(white)).toBe("☖7七銀");
    });
  });

  describe("相対表記", () => {
    test.each([
      ["L", "☗7七銀左"],
      ["C", "☗7七銀直"],
      ["R", "☗7七銀右"],
      ["U", "☗7七銀上"],
      ["M", "☗7七銀寄"],
      ["D", "☗7七銀引"],
    ])("%s を日本語で出す", (relative, expected) => {
      expect(formatMove(withRelative(relative))).toBe(expected);
    });

    test.each([
      ["LU", "☗7七銀左上"],
      ["RD", "☗7七銀右引"],
      ["LM", "☗7七銀左寄"],
    ])("複合コード %s も順に並べる", (relative, expected) => {
      expect(formatMove(withRelative(relative))).toBe(expected);
    });

    test("成りは相対表記の後に来る", () => {
      expect(formatMove({ ...withRelative("R"), promote: true })).toBe("☗7七銀右成");
    });

    test("表に無いコードはそのまま残す", () => {
      expect(formatMove(withRelative("X"))).toBe("☗7七銀X");
    });
  });

  describe("駒打ち", () => {
    const GI_DROP_TO_53: IMoveMoveFormat = {
      to: { x: 5, y: 3 },
      piece: "GI",
      color: Color.Black,
    };

    test("relative が \"H\" なら「打」", () => {
      expect(formatMove({ ...GI_DROP_TO_53, relative: "H" })).toBe("☗5三銀打");
    });

    test("relative が無くても from が無ければ「打」を補う", () => {
      expect(formatMove(GI_DROP_TO_53)).toBe("☗5三銀打");
    });

    test("「打」は重ならない", () => {
      expect(formatMove({ ...GI_DROP_TO_53, relative: "H" })).not.toContain("打打");
    });
  });
});
