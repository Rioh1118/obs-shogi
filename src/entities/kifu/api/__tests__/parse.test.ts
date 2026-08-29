import { describe, expect, test } from "vitest";
import { exportJKF, importCSA } from "tsshogi";
import { readableMove } from "@/entities/kifu/lib/readableMove";
import { parseKifuContentToJKF, parseKifuStringToJKF } from "../parse";

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

  test("盤上で再生できない手を含む棋譜は、tsshogi の出力がそのまま返る", () => {
    // 4手目は 4一の金を 2二 へ動かしていて届かない。正規化はそこで throw するが、
    // その手に same / capture を書き込んでから throw する。CSA と JKF は tsshogi が
    // 「同」を埋めないので、コピーを渡さないと中途半端に書き換わった棋譜が返る。
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
