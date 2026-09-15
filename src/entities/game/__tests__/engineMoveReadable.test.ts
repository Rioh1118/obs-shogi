import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import { Shogi } from "shogi.js";

import { fromUsiMove } from "../lib/usiMove";
import { toIMoveMoveFormat } from "../lib/moveConverter";

/**
 * **エンジンが決めた手が、棋譜の表記として読めること。**
 *
 * エンジンの手は綴りしか持たないので、盤へ載せるまでに
 * `fromUsiMove` → `toIMoveMoveFormat` → `inputMove` を通る（`GameMoveBridge`）。
 * この鎖のどこかで欄を1つ取り違えると、**対局は正しく進むのに棋譜だけが嘘を名乗る。**
 *
 * `getReadableKifu()` は JKF が持つ表記器で、`promote` の有無・`from` の有無・
 * `piece` の種別からしか文字列を組めない。**ここで見るのはその3つが合っているか**で、
 * 表記器そのものの正しさは見ない。
 */

/** SFEN から盤を1面おこす */
function boardOf(sfen: string): Shogi {
  const shogi = new Shogi();
  shogi.initializeFromSFENString(sfen);
  return shogi;
}

/** 綴りを1手ずつ通して、各手の読み下しを並べる */
function readableAfter(startSfen: string, usiMoves: string[]): string[] {
  // **盤は2面いる。** `fromShogi` が渡した盤を持ち続けるので、
  // 駒種を引く側と共用すると `inputMove` の進みと二重に動く
  const shogi = boardOf(startSfen);
  const player = JKFPlayer.fromShogi(boardOf(startSfen));
  const readable: string[] = [];

  for (const usiMove of usiMoves) {
    const move = fromUsiMove(usiMove, shogi, shogi.turn);
    if (move === null) throw new Error(`綴りを戻せない: ${usiMove}`);

    player.inputMove(toIMoveMoveFormat(move));
    readable.push(player.getReadableKifu());

    // 盤も同じ手で進める。**次の手の駒種を引くのはこちら**
    if (move.from) {
      shogi.move(move.from.x, move.from.y, move.to.x, move.to.y, move.promote === true);
    } else {
      shogi.drop(move.to.x, move.to.y, move.piece, move.color);
    }
  }

  return readable;
}

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

describe("エンジンの手の読み下し", () => {
  test("ふつうの手に「不成」が付かない", () => {
    expect(readableAfter(HIRATE, ["7g7f", "3c3d", "2g2f"])).toEqual([
      "☗７六歩",
      "☖３四歩",
      "☗２六歩",
    ]);
  });

  test("成った手は「成」、同じ升へ戻る手は「同」", () => {
    // 角交換。8八角が2二へ成り、同銀で取り返す
    const readable = readableAfter(HIRATE, ["7g7f", "3c3d", "8h2b+", "3a2b"]);

    expect(readable[2]).toBe("☗２二角成");
    expect(readable[3]).toBe("☖同　銀");
  });

  test("成れるのに成らなかった手にだけ「不成」が付く", () => {
    const readable = readableAfter(HIRATE, ["7g7f", "3c3d", "8h2b"]);

    expect(readable[2]).toBe("☗２二角不成");
  });

  /**
   * **「打」は付かない。これは表記器の側の振る舞いで、綴りの戻し方とは関係が無い。**
   *
   * `getReadableKifu()` は `relative` を見て「打」を出すが、`inputMove` は
   * 正規化を通らないのでその欄が埋まらない。**読み込んだ棋譜でも同じ** ——
   * `４五角打` と書かれた KIF を開いても `☗４五角` と出る。
   * 人が打った手も同じ経路（`toIMoveMoveFormat`）なので、**エンジンの手だけがずれることはない。**
   */
  test("打った駒は、升と駒種が出る", () => {
    // 先手が歩を1枚持っている局面
    const withPawnInHand = "4k4/9/9/9/9/9/9/9/4K4 b P 1";

    expect(readableAfter(withPawnInHand, ["P*5e"])).toEqual(["☗５五歩"]);
  });

  test("成駒が動いた手は成駒の名前で出る", () => {
    // 5五にと金、5九に後手玉、5一に先手玉
    const withTokin = "4k4/9/9/9/4+P4/9/9/9/4K4 b - 1";

    expect(readableAfter(withTokin, ["5e5d"])).toEqual(["☗５四と"]);
  });
});
