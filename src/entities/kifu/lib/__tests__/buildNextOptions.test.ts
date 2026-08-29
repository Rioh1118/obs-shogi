import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import { readableMove } from "../readableMove";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { buildNextOptions } from "../buildNextOptions";

/** 3手目に「投了」だけの変化と、指し手の変化が1本ずつ生える棋譜。 */
const KIFU_WITH_RESIGN_FORK = `手合割：平手
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２二角成(88)

変化：3手
   3 投了

変化：3手
   3 ６八銀(79)
`;

function optionsAtTesuu2(): ReturnType<typeof buildNextOptions> {
  const jkf = new JKFPlayer(parseKifuContentToJKF(KIFU_WITH_RESIGN_FORK, "kif"));
  jkf.goto(2);
  return buildNextOptions(jkf);
}

describe("buildNextOptions", () => {
  test("本譜の次が投了でも候補に出す", () => {
    // 棋譜ストリームは投了を行として並べる。局面ナビだけ隠すと項目数が食い違う。
    const jkf = new JKFPlayer(
      parseKifuContentToJKF("手合割：平手\n   1 ７六歩(77)\n   2 投了\n", "kif"),
    );
    jkf.goto(1);
    const options = buildNextOptions(jkf);

    expect(options.map((o) => readableMove(o.moveFormat))).toEqual(["投了"]);
    expect(options[0].isMainLine).toBe(true);
  });

  test("投了だけの変化も候補に残す", () => {
    // 落とすと棋譜ストリームの分岐メニューと項目数が食い違い、
    // 「変化N」が別の分岐を指すようになる。
    const options = optionsAtTesuu2();
    expect(options.map((o) => readableMove(o.moveFormat))).toEqual([
      "☗２二角成",
      "投了",
      "☗６八銀",
    ]);
  });

  test("forkIndex が forks の添字と一致する", () => {
    const options = optionsAtTesuu2();
    expect(options.map((o) => o.forkIndex)).toEqual([undefined, 0, 1]);
  });

  test("棋譜ストリーム側の分岐一覧と同じ文字列・同じ並びになる", () => {
    const jkf = new JKFPlayer(parseKifuContentToJKF(KIFU_WITH_RESIGN_FORK, "kif"));
    jkf.goto(2);
    const forkTexts = jkf.getReadableForkKifu();
    const options = optionsAtTesuu2().filter((o) => !o.isMainLine);

    expect(options.map((o) => readableMove(o.moveFormat))).toEqual(forkTexts);
  });
});
