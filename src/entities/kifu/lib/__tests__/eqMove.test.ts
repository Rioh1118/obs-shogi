import { describe, expect, test } from "vitest";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color } from "shogi.js";
import { eqMove, eqMoveFull, eqMoveMinimal } from "../eqMove";

const KI_FROM_49_TO_39: IMoveMoveFormat = {
  from: { x: 4, y: 9 },
  to: { x: 3, y: 9 },
  piece: "KI",
  color: Color.Black,
};

const KI_FROM_29_TO_39: IMoveMoveFormat = {
  from: { x: 2, y: 9 },
  to: { x: 3, y: 9 },
  piece: "KI",
  color: Color.Black,
};

const KI_DROP_TO_39: IMoveMoveFormat = {
  to: { x: 3, y: 9 },
  piece: "KI",
  color: Color.Black,
};

const GI_DROP_TO_39: IMoveMoveFormat = {
  to: { x: 3, y: 9 },
  piece: "GI",
  color: Color.Black,
};

const KI_FROM_49_TO_38: IMoveMoveFormat = {
  from: { x: 4, y: 9 },
  to: { x: 3, y: 8 },
  piece: "KI",
  color: Color.Black,
};

const FU_FROM_27_TO_26: IMoveMoveFormat = {
  from: { x: 2, y: 7 },
  to: { x: 2, y: 6 },
  piece: "FU",
  color: Color.Black,
};

const FU_FROM_27_TO_26_PROMOTE: IMoveMoveFormat = {
  ...FU_FROM_27_TO_26,
  promote: true,
};

describe("eqMoveMinimal", () => {
  describe("to (移動先) の一致", () => {
    test("to が一致しなければ false", () => {
      expect(eqMoveMinimal(KI_FROM_49_TO_39, KI_FROM_49_TO_38)).toBe(false);
    });

    test("どちらかに to が無ければ false", () => {
      expect(eqMoveMinimal({ piece: "KI" }, KI_DROP_TO_39)).toBe(false);
      expect(eqMoveMinimal(KI_DROP_TO_39, { piece: "KI" })).toBe(false);
    });
  });

  describe("from の有無で move/drop を厳密に区別する (#74 の核)", () => {
    test("既存=指し手 (from 有り) と 入力=打ち (from 無し) は別物扱い", () => {
      expect(eqMoveMinimal(KI_FROM_49_TO_39, KI_DROP_TO_39)).toBe(false);
    });

    test("既存=打ち と 入力=指し手 (対称) も別物扱い", () => {
      expect(eqMoveMinimal(KI_DROP_TO_39, KI_FROM_49_TO_39)).toBe(false);
    });
  });

  describe("move 同士の比較", () => {
    test("同じ from / to / promote は true", () => {
      expect(eqMoveMinimal(KI_FROM_49_TO_39, { ...KI_FROM_49_TO_39 })).toBe(true);
    });

    test("from が違えば false", () => {
      expect(eqMoveMinimal(KI_FROM_49_TO_39, KI_FROM_29_TO_39)).toBe(false);
    });

    test("片方のみ promote=true は false", () => {
      expect(eqMoveMinimal(FU_FROM_27_TO_26, FU_FROM_27_TO_26_PROMOTE)).toBe(false);
    });

    test("両方 promote=true は true", () => {
      expect(eqMoveMinimal(FU_FROM_27_TO_26_PROMOTE, { ...FU_FROM_27_TO_26_PROMOTE })).toBe(true);
    });

    test("promote 未指定と promote=false は同一扱い", () => {
      expect(eqMoveMinimal(FU_FROM_27_TO_26, { ...FU_FROM_27_TO_26, promote: false })).toBe(true);
    });
  });

  describe("drop 同士の比較", () => {
    test("同じ to / piece は true", () => {
      expect(eqMoveMinimal(KI_DROP_TO_39, { ...KI_DROP_TO_39 })).toBe(true);
    });

    test("piece が違えば false", () => {
      expect(eqMoveMinimal(KI_DROP_TO_39, GI_DROP_TO_39)).toBe(false);
    });
  });

  describe("不正入力", () => {
    test("a が undefined なら false", () => {
      expect(eqMoveMinimal(undefined, KI_DROP_TO_39)).toBe(false);
    });

    test("b が undefined なら false", () => {
      expect(eqMoveMinimal(KI_DROP_TO_39, undefined)).toBe(false);
    });

    test("両方 undefined でも false", () => {
      expect(eqMoveMinimal(undefined, undefined)).toBe(false);
    });
  });
});

describe("eqMoveFull", () => {
  test("color が違えば false", () => {
    const white: IMoveMoveFormat = { ...KI_FROM_49_TO_39, color: Color.White };
    expect(eqMoveFull(KI_FROM_49_TO_39, white)).toBe(false);
  });

  test("piece が違えば false (move 同士でも厳密)", () => {
    const asGI: IMoveMoveFormat = { ...KI_FROM_49_TO_39, piece: "GI" };
    expect(eqMoveFull(KI_FROM_49_TO_39, asGI)).toBe(false);
  });

  test("capture / same / relative が異なれば false", () => {
    const withCapture: IMoveMoveFormat = { ...KI_FROM_49_TO_39, capture: "FU" };
    expect(eqMoveFull(KI_FROM_49_TO_39, withCapture)).toBe(false);

    const withSame: IMoveMoveFormat = { ...KI_FROM_49_TO_39, same: true };
    expect(eqMoveFull(KI_FROM_49_TO_39, withSame)).toBe(false);

    const withRelative: IMoveMoveFormat = { ...KI_FROM_49_TO_39, relative: "L" };
    expect(eqMoveFull(KI_FROM_49_TO_39, withRelative)).toBe(false);
  });

  test("全フィールド一致なら true", () => {
    const a: IMoveMoveFormat = {
      from: { x: 2, y: 7 },
      to: { x: 2, y: 6 },
      piece: "FU",
      color: Color.Black,
      capture: "FU",
      same: true,
      relative: "L",
    };
    expect(eqMoveFull(a, { ...a })).toBe(true);
  });
});

describe("eqMove (デフォルト = eqMoveMinimal)", () => {
  test("eqMoveMinimal と同じ参照", () => {
    expect(eqMove).toBe(eqMoveMinimal);
  });
});
