import { describe, expect, test } from "vitest";
import type { KifuCreationOptions } from "@/entities/kifu/model/kifu";
import { createInitialJKFData } from "../createInitialJKFData";

const base: KifuCreationOptions = {
  fileName: "x",
  format: "kif",
  gameInfo: {},
  initialPosition: { preset: "HIRATE" },
};

describe("createInitialJKFData", () => {
  test("moves は開始局面のエントリ1つで始まる", () => {
    // moves[0] は指し手ではない。空にすると JKFPlayer が組めない
    expect(createInitialJKFData(base).moves).toEqual([{}]);
  });

  test("空の対局者名は header に載せない", () => {
    const jkf = createInitialJKFData({ ...base, gameInfo: { black: "", white: "後手" } });

    expect(jkf.header["先手"]).toBeUndefined();
    expect(jkf.header["後手"]).toBe("後手");
  });

  test("tags は空なら載せない", () => {
    expect(
      createInitialJKFData({ ...base, gameInfo: { tags: [] } }).header["tags"],
    ).toBeUndefined();
    expect(createInitialJKFData({ ...base, gameInfo: { tags: ["a", "b"] } }).header["tags"]).toBe(
      "a,b",
    );
  });

  // data を載せるのは OTHER のときだけ。preset があるのに data も載せると
  // どちらが効くかが読み手に分からない
  test("data を載せるのは preset が OTHER のときだけ", () => {
    const board = [[{ color: 0, kind: "OU" }]];
    const other = createInitialJKFData({
      ...base,
      initialPosition: {
        preset: "OTHER",
        data: { board },
      } as KifuCreationOptions["initialPosition"],
    });
    const hirate = createInitialJKFData({
      ...base,
      initialPosition: {
        preset: "HIRATE",
        data: { board },
      } as KifuCreationOptions["initialPosition"],
    });

    expect(other.initial?.data).toBeDefined();
    expect(hirate.initial?.data).toBeUndefined();
  });
});
