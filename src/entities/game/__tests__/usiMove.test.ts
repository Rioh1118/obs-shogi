import { describe, expect, test } from "vitest";
import { Color, Shogi } from "shogi.js";
import { Position } from "tsshogi";

import { fromUsiMove, toUsiMove } from "../lib/usiMove";
import type { StandardMoveFormat } from "../model/types";

/**
 * 盤の手を USI の綴りにする。
 *
 * **突き合わせる相手を持つ。** 綴りが正しいかを字面だけで見ると、
 * 段の写し違い（`7g7f` が `7g76`）が「文字列として等しい」で通ってしまう。
 * ここは**同じ局面に同じ手を、盤の側と tsshogi の側から当てて、
 * 出来上がる局面が一致すること**まで見る。
 */

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

/** その綴りを平手から指した結果の局面。**読めない綴りなら `null`** */
function sfenAfter(usiMove: string, startSfen = HIRATE): string | null {
  const position = Position.newBySFEN(startSfen);
  if (!position) return null;
  const move = position.createMoveByUSI(usiMove);
  if (!move) return null;
  return position.doMove(move) ? position.sfen : null;
}

describe("USI の綴り", () => {
  test("移動は「筋・段・筋・段」", () => {
    const move: StandardMoveFormat = {
      from: { x: 7, y: 7 },
      to: { x: 7, y: 6 },
      piece: "FU",
      color: Color.Black,
    };

    expect(toUsiMove(move)).toBe("7g7f");
    // 盤が意図した手として tsshogi にも通る
    expect(sfenAfter("7g7f")).not.toBeNull();
  });

  test("成りは末尾の `+` だけ。**成った後の駒種を書かない**", () => {
    const move: StandardMoveFormat = {
      from: { x: 2, y: 2 },
      to: { x: 3, y: 1 },
      piece: "KA",
      promote: true,
      color: Color.Black,
    };

    expect(toUsiMove(move)).toBe("2b3a+");
  });

  test("成らない手に `+` を付けない", () => {
    const move: StandardMoveFormat = {
      from: { x: 2, y: 2 },
      to: { x: 3, y: 1 },
      piece: "KA",
      promote: false,
      color: Color.Black,
    };

    expect(toUsiMove(move)).toBe("2b3a");
  });

  test("駒打ちは「駒・`*`・筋段」", () => {
    const move: StandardMoveFormat = {
      to: { x: 5, y: 5 },
      piece: "FU",
      color: Color.Black,
    };

    expect(toUsiMove(move)).toBe("P*5e");
  });

  /** **玉は打てない。** 綴れてしまうと、エンジンが解釈できない行が飛ぶ */
  test("打てない駒は綴らない", () => {
    expect(toUsiMove({ to: { x: 5, y: 5 }, piece: "OU", color: Color.Black })).toBeNull();
    expect(toUsiMove({ to: { x: 5, y: 5 }, piece: "TO", color: Color.Black })).toBeNull();
  });

  test("盤の外は綴らない", () => {
    expect(
      toUsiMove({ from: { x: 0, y: 7 }, to: { x: 7, y: 6 }, piece: "FU", color: Color.Black }),
    ).toBeNull();
    expect(
      toUsiMove({ from: { x: 7, y: 7 }, to: { x: 7, y: 10 }, piece: "FU", color: Color.Black }),
    ).toBeNull();
  });

  /**
   * **段の写し違いを、字面ではなく結果で捕まえる。**
   * 9段ぶん全部を1手ずつ当て、`a`〜`i` の対応がずれていないことを見る。
   */
  test("段の対応が9つとも合っている", () => {
    // 盤を空にして、先手の飛車1枚だけを置いた局面。5筋を上から下まで指せる
    const rookOnly = "4k4/9/9/9/9/9/9/4R4/4K4 b - 1";

    for (let y = 1; y <= 9; y++) {
      const usi = toUsiMove({
        from: { x: 5, y: 8 },
        to: { x: 5, y },
        piece: "HI",
        color: Color.Black,
      });
      expect(usi).toBe(`5h5${"abcdefghi"[y - 1]}`);
    }

    // 8段目から5段目へ引いた手が、tsshogi にも同じ手として通る
    expect(sfenAfter("5h5e", rookOnly)).toContain("4R4");
  });
});

/**
 * **`promote` の欄は3つの状態を持つ。**
 *
 * JKF の README がそう決めている —— `true:成, false:不成, 無いかnull:どちらでもない`。
 * `getReadableKifu()` はこの欄だけを見て「不成」を出すので、
 * **成れない手に `false` を載せると「２六歩不成」になる。**
 *
 * エンジンが決めた手はここを通ってしか盤へ載らない（`GameMoveBridge`）。
 * 人の手は `selectSquare` の引数が `undefined` のまま来て
 * `toIMoveMoveFormat` が欄ごと落とすので、**ずれるのはこちら側だけ。**
 */
describe("USI の綴りから戻した手の `promote`", () => {
  /** 2四に先手の歩を置いた局面。2三へ進むと敵陣に入る */
  const PAWN_ON_2D = "lnsgkgsnl/1r5b1/ppppppppp/7P1/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

  function boardOf(sfen: string): Shogi {
    const shogi = new Shogi();
    shogi.initializeFromSFENString(sfen);
    return shogi;
  }

  test("成れない手には欄を載せない", () => {
    const move = fromUsiMove("2g2f", boardOf(HIRATE), Color.Black);

    expect(move).not.toBeNull();
    // **欄の有無で見る。`toBe(undefined)` では足りない** —— 欄が在って `undefined` でも
    // 通ってしまうので、`false` を載せる実装へ戻したときにしか落ちない
    expect("promote" in (move as object)).toBe(false);
  });

  test("成れるのに成らなかった手には `false` を載せる", () => {
    const move = fromUsiMove("2d2c", boardOf(PAWN_ON_2D), Color.Black);

    // 落とすと「不成」が消えて、成った手と同じ綴りが2つの手を指す
    expect(move?.promote).toBe(false);
  });

  test("成った手には `true` を載せる", () => {
    const move = fromUsiMove("2d2c+", boardOf(PAWN_ON_2D), Color.Black);

    expect(move?.promote).toBe(true);
  });
});
