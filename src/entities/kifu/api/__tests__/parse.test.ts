import { describe, expect, test } from "vitest";
import { exportJKF, importCSA } from "tsshogi";
import { readableMove } from "@/entities/kifu/lib/readableMove";
import { parseKifuContentToJKF, parseKifuStringToJKF, readKifuText } from "../parse";

/** 同じ手順を CSA と KIF で書いたもの。4手目が「同銀」。 */
const CSA = `V2.2
P1-KY-KE-GI-KI-OU-KI-GI-KE-KY
P2 * -HI *  *  *  *  * -KA *
P3-FU-FU-FU-FU-FU-FU-FU-FU-FU
P4 *  *  *  *  *  *  *  *  *
P5 *  *  *  *  *  *  *  *  *
P6 *  *  *  *  *  *  *  *  *
P7+FU+FU+FU+FU+FU+FU+FU+FU+FU
P8 * +KA *  *  *  *  * +HI *
P9+KY+KE+GI+KI+OU+KI+GI+KE+KY
+
+7776FU
-3334FU
+8822UM
-3122GI
`;

const KIF = `手合割：平手
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２二角成(88)
   4 同　銀(31)
`;

function texts(content: string, format: "kif" | "csa"): string[] {
  const jkf = parseKifuContentToJKF(content, format);
  return jkf.moves.flatMap((mf) => (mf.move ? [readableMove(mf)] : []));
}

describe("parseKifuContentToJKF", () => {
  test("形式が違っても同じ手順は同じ表記になる", () => {
    // CSA には「同」の表記が無く、正規化を通さないと ☖２二銀 になる。
    expect(texts(CSA, "csa")).toEqual(texts(KIF, "kif"));
    expect(texts(CSA, "csa")[3]).toBe("☖同　銀");
  });

  test("盤上で再生できない手を含む棋譜は、未正規化のまま返る", () => {
    // 4手目は 4一の金を 2二 へ動かしていて届かない。正規化はそこで throw するが、
    // その手に same / capture を書き込んでから throw する。CSA と JKF は tsshogi が
    // 「同」を埋めないので、コピーを渡さないと中途半端に書き換わった棋譜が返る。
    // 空の変化を落とす sanitize は通るので、比較は toEqual（構造の一致）で行う。
    const broken = CSA.replace("-3122GI", "-4122KI");
    const rec = importCSA(broken);
    if (rec instanceof Error) throw rec;

    expect(parseKifuContentToJKF(broken, "csa")).toEqual(exportJKF(rec));
  });

  test("空の棋譜は KifuParseError", () => {
    expect(() => parseKifuContentToJKF("   ", "kif")).toThrow();
  });
});

describe("parseKifuStringToJKF", () => {
  test("形式を判定しても表記は揃う", () => {
    const fromCsa = parseKifuStringToJKF(CSA);
    const fromKif = parseKifuStringToJKF(KIF);

    expect(fromCsa.detectedFormat).toBe("csa");
    expect(fromKif.detectedFormat).toBe("kif");
    expect(fromCsa.jkf.moves.flatMap((m) => (m.move ? [readableMove(m)] : []))).toEqual(
      fromKif.jkf.moves.flatMap((m) => (m.move ? [readableMove(m)] : [])),
    );
  });
});

/**
 * 棋譜テキストが**棋譜として使えるか**の判定。
 *
 * **投げなかったことを「読めた」と読まない。** 通すと、呼んだ側は中身の無い棋譜を
 * 「読めた」前提で扱う。この穴はパーサの性質なので、判定はここが1つ持つ。
 */
describe("readKifuText", () => {
  test("指し手が読めれば、判定した形式と手数を返す", () => {
    const read = readKifuText(CSA);

    expect(read).toEqual({ readable: true, format: "csa", moves: 4 });
  });

  test("棋譜でない文章は、投げないが読めていない", () => {
    // KIF / KI2 / CSA のインポータは指し手を1つも読めなくても Error を返さない
    expect(parseKifuStringToJKF("これは棋譜ではないただの文章です").jkf.moves).toHaveLength(1);

    const read = readKifuText("これは棋譜ではないただの文章です");

    expect(read.readable).toBe(false);
  });

  test("空のテキストも読めていない", () => {
    expect(readKifuText("   ").readable).toBe(false);
  });

  test("利用者に見せる一文と、開発者向けの手掛かりを分けて返す", () => {
    const read = readKifuText("{ これは JSON ではない");
    if (read.readable) throw new Error("読めないはずのテキストが読めた");

    // 見せる側は日本語の一文だけ。tsshogi が返した英文は cause に置く
    expect(read.message).toBe("JKF(JSON)の解析に失敗しました。");
    expect(read.message).not.toContain("Error");
    expect(read.cause).toBeTruthy();
  });

  test("その場で何をすればよいかは含めない。入口ごとに違う", () => {
    const read = readKifuText("これは棋譜ではないただの文章です");
    if (read.readable) throw new Error("読めないはずのテキストが読めた");

    expect(read.message).not.toContain("貼り");
  });
});
