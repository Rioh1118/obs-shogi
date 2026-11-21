import { describe, expect, test } from "vitest";
import type { IHandFormat, IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color } from "shogi.js";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { JKFPlayer } from "json-kifu-format";
import { readableCurrentMove, readableMove, readableNextForks } from "../readableMove";
import { buildJkf, hand, KINGS, type Placement } from "./fixtures";

/**
 * 棋譜を読んで各手の表記を並べる
 *
 * KIF で書ける場面は KIF で書く。手をリテラルで組むと `promote: false`（不成）のように
 * 実データにだけ現れる形が抜ける。
 *
 * 逆に期待値の文字列は手で書く。ライブラリから取ると同じ関数を左右に置いた恒真テストになり、
 * 委譲先が変わっても落ちなくなる。
 */
function readableMovesOf(content: string, format: "kif" | "jkf"): string[] {
  const jkf = parseKifuContentToJKF(content, format);
  return jkf.moves.flatMap((mf) => (mf.move ? [readableMove(mf)] : []));
}

/**
 * 盤面を置いた棋譜を読んで各手の表記を並べる
 *
 * 平手から短い手順では作れない配置のときだけ使う。手はリテラルで組むが、
 * パーサに通してから `readableMove` に渡す。未正規化の手は `color` も `relative` も
 * 持たず、例外も出さずに違う文字列になる。
 */
function readableMovesOnBoard(
  pieces: Placement[],
  hands: [Partial<IHandFormat>, Partial<IHandFormat>],
  move: IMoveMoveFormat,
): string[] {
  const jkf = buildJkf(pieces, [hand(hands[0]), hand(hands[1])], [{}, { move }]);
  return readableMovesOf(JSON.stringify(jkf), "jkf");
}

const HIRATE = "手合割：平手\n";

describe("readableMove", () => {
  test("手番・移動先・駒種を繋げる", () => {
    const [first, second] = readableMovesOf(`${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n`, "kif");
    expect(first).toBe("☗７六歩");
    expect(second).toBe("☖３四歩");
  });

  test("成は「成」、直前と同じ地点は「同」", () => {
    const moves = readableMovesOf(
      `${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角成(88)\n   4 同　銀(31)\n`,
      "kif",
    );
    expect(moves[2]).toBe("☗２二角成");
    expect(moves[3]).toBe("☖同　銀");
  });

  test("不成が「不成」として残る（成れない手と混ざらない）", () => {
    const moves = readableMovesOf(
      `${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角(88)\n`,
      "kif",
    );
    expect(moves[2]).toBe("☗２二角不成");
  });

  describe("相対表記", () => {
    test("左右のみで決まるなら1文字", () => {
      // 平手の初期配置に金は 6九 と 4九。どちらも 5八 に行ける。
      expect(readableMovesOf(`${HIRATE}   1 ５八金(49)\n`, "kif")[0]).toBe("☗５八金右");
    });

    test("上下も左右も他の駒がいるなら2文字を順に並べる", () => {
      const moves = readableMovesOnBoard(
        [
          ...KINGS,
          { x: 6, y: 8, color: Color.Black, kind: "KI" },
          { x: 6, y: 9, color: Color.Black, kind: "KI" },
          { x: 4, y: 9, color: Color.Black, kind: "KI" },
        ],
        [{}, {}],
        { from: { x: 6, y: 9 }, to: { x: 5, y: 8 }, piece: "KI", color: Color.Black },
      );
      expect(moves[0]).toBe("☗５八金左上");
    });
  });

  describe("駒打ち", () => {
    test("盤上の駒も同じ地点に行けるなら「打」で区別する", () => {
      const moves = readableMovesOnBoard(
        [...KINGS, { x: 4, y: 4, color: Color.Black, kind: "GI" }],
        [{ GI: 1 }, {}],
        { to: { x: 5, y: 3 }, piece: "GI", color: Color.Black },
      );
      expect(moves[0]).toBe("☗５三銀打");
    });

    test("区別が要らない打には「打」を付けない（棋譜の作法どおり）", () => {
      const moves = readableMovesOf(
        `${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角(88)\n   4 同　銀(31)\n   5 ４五角打\n`,
        "kif",
      );
      expect(moves[4]).toBe("☗４五角");
    });
  });
});

/**
 * 棋譜変換クレートが JKF に足した終局の語は、記号ではなく日本語で出す。
 *
 * `JKFPlayer` は標準の14語しか知らず、`FUUJITE` をそのまま出す。
 * 期待値は手で書く（ライブラリの表から取ると恒真になる）。
 */
describe("readableMove: JKF の拡張の終局", () => {
  test.each([
    ["FUSENSHO", "不戦勝"],
    ["FUSENPAI", "不戦敗"],
    ["FUUJITE", "封じ手"],
    ["MAX_MOVES", "最大手数"],
  ])("%s は %s", (special, want) => {
    expect(readableMove({ special } as never)).toBe(want);
  });

  test("標準の語は JKFPlayer の表記のまま", () => {
    expect(readableMove({ special: "TORYO" })).toBe("投了");
  });
});

// 画面の KIF の読み手（tsshogi）は封じ手を JKF に書けず落とす。`FUUJITE` が
// 画面に届くのは、バックエンド（棋譜変換クレート）が作った JKF から
describe("readableCurrentMove", () => {
  test("今の手を拡張の終局の語で出し、手数0は開始局面", () => {
    const jkf = parseKifuContentToJKF(
      "手合割：平手\n手数----指手---------消費時間--\n   1 ７六歩(77)\n",
      "kif",
    );
    jkf.moves.push({ special: "FUUJITE" } as never);
    const player = new JKFPlayer(jkf as never);
    player.goto(2);
    expect(readableCurrentMove(player)).toBe("封じ手");
    player.goto(0);
    expect(readableCurrentMove(player)).toBe("開始局面");
  });
});

describe("readableNextForks", () => {
  test("変化の1手目も拡張の終局の語で出す", () => {
    const jkf = parseKifuContentToJKF(
      "手合割：平手\n手数----指手---------消費時間--\n   1 ７六歩(77)\n",
      "kif",
    );
    jkf.moves[1] = {
      ...jkf.moves[1],
      forks: [[{ special: "FUUJITE" }]],
    } as never;
    const player = new JKFPlayer(jkf as never);
    expect(readableNextForks(player)).toEqual(["封じ手"]);
  });
});
