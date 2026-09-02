import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { docsPath, markdownFiles } from "./stateTransitionIndex";
import { codeOf } from "./sourceText";
import { identifiersIn, missingIdentifiers, missingIn } from "./docsIdentifiers";

/**
 * 状態遷移表がバッククォートで指す識別子が、ソースに実在するかを見る。
 *
 * 表は「現物を引くための索引」として書かれている。書いてある名前で grep して
 * 空振りすると、読み手は「表が古い」以上のことを判断できない。
 * 改名すると腐るのに、パスと違って `docsSourcePaths` は見ていなかった。
 *
 * 実際に腐った例が2つある。`CLOSE_QUIET_TIMEOUT`（`CLOSE_SETTLE_TIMEOUT` へ改名）と
 * `elapsed_ms`（`running_clock` へ改名）で、どちらも改名した本人が同じ日に書いた表。
 *
 * **後者はこの検査では止まらない。** `elapsed_ms` は別の場所（イベントの欄名、
 * `clock.rs` の引数名）に綴りとして在るので、「在るか」しか見ないここは緑になる。
 * 止められるのは**綴りごと消えた名前**だけ。
 *
 * 範囲を状態遷移表に絞る理由は `docsSourcePaths.test.ts` と同じ。
 * ADR と `IDEAS.md` は別リポジトリの識別子を根拠として引く。
 */
describe("状態遷移表が指す識別子", () => {
  const tableFiles = () => markdownFiles().filter((f) => f.startsWith("state-transitions/"));

  // 0件を見て緑になる形を止める
  test("状態遷移表から識別子を拾えている", () => {
    const found = tableFiles().flatMap((relative) =>
      identifiersIn(readFileSync(docsPath(relative), "utf8")),
    );

    expect(found.length).toBeGreaterThan(10);
  });

  test("ソースに無い識別子を指していない", () => {
    const broken = tableFiles().flatMap((relative) => {
      const body = readFileSync(docsPath(relative), "utf8");
      return missingIdentifiers(identifiersIn(body)).map((name) => `${relative}: ${name}`);
    });

    expect(broken, "改名したら表も直すこと。落とすなら行ごと落とすこと").toEqual([]);
  });
});

describe("identifiersIn", () => {
  test("大文字の定数を拾う", () => {
    expect(identifiersIn("上限は `CLOSE_SETTLE_TIMEOUT`")).toEqual(["CLOSE_SETTLE_TIMEOUT"]);
  });

  test("小文字の関数を拾う。括弧は落とす", () => {
    expect(identifiersIn("番人は `running_clock()`")).toEqual(["running_clock"]);
  });

  // 表の記号を拾うと、行を足すたびに赤くなる
  test("表の記号は拾わない", () => {
    expect(identifiersIn("`A3` の行と `E11` と `G0`")).toEqual([]);
  });

  // 下線で切っている。桁数で切ると `SFEN` が残る
  test("頭字語は拾わない", () => {
    expect(identifiersIn("`USI` と `SFEN` と `KIF`")).toEqual([]);
  });

  test("バッククォートの外は拾わない", () => {
    expect(identifiersIn("CLOSE_SETTLE_TIMEOUT を見る")).toEqual([]);
  });

  // 型名は下線を含まないので拾わない。拾えると嬉しいが、
  // `Phase` のような一語の型は地の文の英単語と区別できない
  test("キャメルケースの型名は拾わない", () => {
    expect(identifiersIn("`GameSession` の `Phase`")).toEqual([]);
  });
});

describe("コメントを落としてから数える", () => {
  // この検査は自分の doc に腐った名前を引いていて、それで空回りしていた
  test("行コメントの中の名前は数に入らない", () => {
    expect(missingIn(["DEAD_NAME"], codeOf("let x = 1; // DEAD_NAME のこと"))).toEqual([
      "DEAD_NAME",
    ]);
  });

  test("ブロックコメントも落とす", () => {
    expect(missingIn(["DEAD_NAME"], codeOf("/** DEAD_NAME */ let x = 1;"))).toEqual(["DEAD_NAME"]);
  });

  test("コードは残す", () => {
    expect(missingIn(["LIVE_NAME"], codeOf("const LIVE_NAME = 1; // 説明"))).toEqual([]);
  });
});

describe("missingIn", () => {
  test("在るものは返さない", () => {
    expect(missingIn(["running_clock"], "fn running_clock(&self)")).toEqual([]);
  });

  test("無いものだけ返す", () => {
    expect(missingIn(["running_clock", "elapsed_ms"], "fn running_clock(&self)")).toEqual([
      "elapsed_ms",
    ]);
  });
});
