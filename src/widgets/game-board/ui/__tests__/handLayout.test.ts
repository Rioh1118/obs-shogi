// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { Piece } from "shogi.js";

import { useHandLayout } from "../useHandLayout";

/**
 * 駒台の並べ方。**枚数で段と駒の大きさが変わる。**
 *
 * 並べ方は見た目だけを決めるが、段の割り振りを誤ると駒台からはみ出すか、
 * 1段だけに詰まって隣の段が空く。どの段に何を置くかと、段ごとの大きさを固定する。
 */

const piecesOf = (...kinds: string[]) => kinds.map((kind) => new Piece(`+${kind}`));

function layoutOf(...kinds: string[]) {
  return renderHook(() => useHandLayout(piecesOf(...kinds))).result.current;
}

describe("駒台の段", () => {
  test.each([
    [["FU", "KA", "HI"], { row1: ["HI", "KA", "FU"], row2: [], row3: [], row4: [] }],
    [["FU", "KI"], { row1: [], row2: ["KI", "FU"], row3: [], row4: [] }],
    [["KE"], { row1: [], row2: [], row3: ["KE"], row4: [] }],
    [["FU", "FU"], { row1: [], row2: [], row3: [], row4: ["FU", "FU"] }],
  ])("1段に収まるなら、いちばん強い駒の段に置く（%j）", (kinds, rows) => {
    expect(layoutOf(...kinds).arrangedPieces).toEqual(rows);
  });

  test("収まらなければ、強い順に4段へ均して置く", () => {
    const { arrangedPieces, layoutConfig } = layoutOf(
      "FU",
      "KY",
      "GI",
      "GI",
      "KI",
      "KI",
      "KA",
      "HI",
    );

    expect(arrangedPieces).toEqual({
      row1: ["HI", "KA"],
      row2: ["KI", "KI"],
      row3: ["GI", "GI"],
      row4: ["KY", "FU"],
    });
    expect(layoutConfig).toMatchObject({ maxPiecesPerRow: 5, pieceSize: 4.0, gap: 0.3 });
  });

  test("枚数が多いと1段の上限を上げ、余りは最後の段に寄せる", () => {
    const { arrangedPieces, layoutConfig } = layoutOf(...Array<string>(18).fill("FU"));

    expect(arrangedPieces.row1).toHaveLength(5);
    expect(arrangedPieces.row2).toHaveLength(5);
    expect(arrangedPieces.row3).toHaveLength(5);
    expect(arrangedPieces.row4).toHaveLength(3);
    expect(layoutConfig).toMatchObject({ maxPiecesPerRow: 7, pieceSize: 3.2, gap: 0.2 });
  });

  test("11枚から15枚は1段の上限が6になる", () => {
    const { layoutConfig } = layoutOf(...Array<string>(12).fill("FU"));

    expect(layoutConfig).toMatchObject({ maxPiecesPerRow: 6, pieceSize: 3.6, gap: 0.25 });
  });

  test("持ち駒が無ければ、どの段も空", () => {
    expect(layoutOf().arrangedPieces).toEqual({ row1: [], row2: [], row3: [], row4: [] });
  });
});

describe("段ごとの駒の大きさ", () => {
  test("3枚までの段は少し大きく、空の段は基準のまま", () => {
    const { layoutConfig } = layoutOf("FU", "KA", "HI");

    expect(layoutConfig.getRowConfig([])).toEqual({ pieceSize: 4.5, gap: 0.4 });
    const few = layoutConfig.getRowConfig(["HI", "KA", "FU"]);
    expect(few.pieceSize).toBeCloseTo(4.95);
    expect(few.gap).toBeCloseTo(0.48);
  });

  test("幅に収まる段は基準のまま、収まらない段は縮め、下限で止める", () => {
    const { layoutConfig } = layoutOf(...Array<string>(18).fill("FU"));

    expect(layoutConfig.getRowConfig(Array<string>(5).fill("FU"))).toEqual({
      pieceSize: 3.2,
      gap: 0.2,
    });

    const crowded = layoutConfig.getRowConfig(Array<string>(6).fill("FU"));
    expect(crowded.pieceSize).toBe(2.8);
    expect(crowded.gap).toBeCloseTo((0.2 * (18 * 0.95)) / (6 * 3.2 + 5 * 0.2));

    const fits = layoutConfig.getRowConfig(Array<string>(4).fill("FU"));
    expect(fits).toEqual({ pieceSize: 3.2, gap: 0.2 });
  });

  test("縮めた大きさが下限より大きければ、縮めた値を使う", () => {
    const { arrangedPieces, layoutConfig } = layoutOf("FU", "FU", "FU", "FU");
    const scale = (18 * 0.95) / (4 * 4.5 + 3 * 0.4);

    const row = layoutConfig.getRowConfig(arrangedPieces.row4);
    expect(row.pieceSize).toBeCloseTo(4.5 * scale);
    expect(row.gap).toBeCloseTo(0.4 * scale);
  });
});
