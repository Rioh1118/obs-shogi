import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, rustRoots, SRC, sourceFiles } from "./walk";

/**
 * **「中断」は利用者の意思で終わらせたときの語**（ADR-0011 決定1）。
 *
 * 裁定が返らないまま `RULING_TIMEOUT` を過ぎた終局はアプリの故障で、
 * 理由は `RulingTimeout`（画面の語は「アプリの異常」）。値も画面の語も別なので、
 * **その打ち切りを「中断」と呼んだコメントは、読んだ人に `Aborted` を探させる。**
 *
 * **同じ形は繰り返し入る** —— 打ち切りを説明する文は「対局が終わる」を言いたくなり、
 * そこでいちばん短い動詞が「中断」だから。
 *
 * **見るのは打ち切りを名指したコメントだけ。** 「中断」を単独で禁じると、
 * `abortGame` の周りの正しい用法を全部巻き込む。逆に、打ち切りの綴りを名指さずに
 * 「必ず中断される」とだけ書いた文はここでは拾えない —— この走査が塞ぐのは
 * **打ち切りと中断を同じ息で結んだ形**で、語の用法そのものではない。
 */

/** 打ち切りを名指す綴り。Rust の定数・variant と、線に出る値 */
const TIMEOUT_SPELLINGS = "RULING_TIMEOUT|rulingTimeout|RulingTimeout";

/**
 * 打ち切りが「中断」で終わると読める形。
 *
 * **句点を跨がない。** 跨ぐと、2つを**対比した**正しい文
 * （「利用者の中断とは別。〜は `RulingTimeout` で畳む」）まで赤くなる。
 * 順序も向きも固定する —— 打ち切りを名指した**後**に「中断」が来る形だけを見る。
 */
const TIMEOUT_CALLED_ABORT = new RegExp(`(?:${TIMEOUT_SPELLINGS})[^。]{0,40}中断`);

/** `//` 行コメントと `/* *\/` ブロックコメント */
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * 複数行のコメントを1本の文へ潰す。
 *
 * **潰さないと、行をまたいだ形が素通りする** —— 打ち切りの綴りで行が終わり、
 * 次の行が「中断される」で始まる書き方が現にある。
 */
function flatten(comment: string): string {
  return comment.replace(/\n\s*(?:\*|\/\/)?\s*/g, "");
}

describe("終局の語彙", () => {
  it("裁定の打ち切りを「中断」と呼んでいない", () => {
    const offenders: string[] = [];
    /** 打ち切りを名指したコメントの数。**0 になっても違反0は出る** */
    let named = 0;
    let blocks = 0;

    for (const root of [SRC, ...rustRoots()]) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        const name = relative(REPO_ROOT, file);

        for (const match of source.matchAll(COMMENT)) {
          blocks += 1;
          const text = flatten(match[0]);
          if (!new RegExp(TIMEOUT_SPELLINGS).test(text)) continue;
          named += 1;
          if (!TIMEOUT_CALLED_ABORT.test(text)) continue;

          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${name}:${line}  ${text.slice(0, 80).trim()}`);
        }
      }
    }

    // **走査が空振りしても「違反0」になる。** コメントを1本も読めていない形と、
    // 打ち切りを名指したコメントに1本も当たっていない形を別に止める。
    // 実測値は書かない（コメントは増える）。丸ごと壊れた場合だけを取る位置に置く
    expect(blocks, "コメントを読めていない").toBeGreaterThan(5000);
    expect(named, "打ち切りを名指したコメントに1本も当たっていない").toBeGreaterThan(25);

    expect(
      offenders,
      [
        "裁定の打ち切りを「中断」と呼んでいる。",
        "「中断」は利用者が中断を押したときの語で、値は `Aborted`（ADR-0011 決定1）。",
        "打ち切りで畳まれた終局は `RulingTimeout`、画面の語は「アプリの異常」。",
        "「`RULING_TIMEOUT` で畳まれる」のように、終わり方を言い直さずに書くこと。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
