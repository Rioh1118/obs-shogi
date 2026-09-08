import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { docsPath } from "./stateTransitionIndex";
import { codeOf } from "./sourceText";
import { scannedDocs } from "./docsSourcePaths";
import { identifiersIn, missingIdentifiers, missingIn } from "./docsIdentifiers";

/**
 * `scannedDocs()` が返す doc がバッククォートで指す識別子が、ソースに実在するかを見る。
 *
 * 表は「現物を引くための索引」として書かれている。書いてある名前で grep して
 * 空振りすると、読み手は「表が古い」以上のことを判断できない。
 * パスは `docsSourcePaths` が見る。名前はこちらが見る。
 *
 * **止められるのは「綴りが1つも残っていない名前」だけ。** 限界は4つあり、
 * どれも `docsIdentifiers.ts` の doc に書いてある。要約すると、
 * 別の場所に同じ綴りが在る改名・型名やバリアント名・Rust のコメントは
 * すべて素通りする。**この検査が緑でも、doc の識別子は保証されない。**
 *
 * **走査する範囲はパスの検査と同じ**（`scannedDocs`。理由もあちらの doc が持つ）。
 * 片方だけを広げると、同じファイルでパスは検査され識別子は検査されない状態が残る。
 */
describe("doc が指す識別子", () => {
  // 0件を見て緑になる形を止める
  test("doc から識別子を拾えている", () => {
    const found = scannedDocs().flatMap((relative) =>
      identifiersIn(readFileSync(docsPath(relative), "utf8")),
    );

    expect(found.length).toBeGreaterThan(10);
  });

  test("ソースに無い識別子を指していない", () => {
    const broken = scannedDocs().flatMap((relative) => {
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

  // 大文字だけの枝は下線を要求している。桁数で切ると `SFEN` が残る
  test("頭字語は拾わない", () => {
    expect(identifiersIn("`USI` と `SFEN` と `KIF`")).toEqual([]);
  });

  test("バッククォートの外は拾わない", () => {
    expect(identifiersIn("CLOSE_SETTLE_TIMEOUT を見る")).toEqual([]);
  });

  // 大文字始まりを受ける枝が無い。拾えると嬉しいが、
  // `Phase` のような一語の型は地の文の英単語と区別できない
  test("PascalCase の型名は拾わない", () => {
    expect(identifiersIn("`GameSession` の `Phase`")).toEqual([]);
  });

  // **このリポジトリで実際に腐るのは TS 側の綴り。** 枝を落とす変異を赤くする
  test("camelCase の綴りを拾う", () => {
    expect(identifiersIn("`isReady` と `analyzedSfen` を見る")).toEqual([
      "analyzedSfen",
      "isReady",
    ]);
  });
});

describe("コメントを落としてから数える", () => {
  // コメントの中の言及を「実在」と数えない。数えると、腐った名前を説明した
  // 1行がその名前を生き返らせる
  test("行コメントの中の名前は数に入らない", () => {
    expect(missingIn(["DEAD_NAME"], codeOf("let x = 1; // DEAD_NAME のこと"))).toEqual([
      "DEAD_NAME",
    ]);
  });

  // **2行目以降も落ちることを見る。** 1本しか置かないと、最初の1本だけを消す形でも
  // 通ってしまう。実 corpus はほぼ全ファイルが行コメントを複数持つので、
  // 取りこぼす側に倒れると「無い」はずの名前がまとめて「実在する」へ戻る
  test("行コメントは2本目以降も落とす", () => {
    const src = "let x = 1; // 説明\nlet y = 2; // DEAD_NAME のこと\n";

    expect(missingIn(["DEAD_NAME"], codeOf(src))).toEqual(["DEAD_NAME"]);
  });

  test("ブロックコメントも落とす", () => {
    expect(missingIn(["DEAD_NAME"], codeOf("/** DEAD_NAME */ let x = 1;"))).toEqual(["DEAD_NAME"]);
  });

  // **ブロックの手前にある行コメントも落とす。** ブロックを持たないファイルは
  // 1本の経路で落ちるが、実 corpus はほぼ全ファイルがブロックと行コメントを
  // 両方持つ。そちらが通る経路を突かないと、行コメントの中の名前が
  // まとめて「実在する」へ戻る
  test("ブロックの手前の行コメントも落とす", () => {
    const src = "// DEAD_NAME のこと\n/** 説明 */\nconst a = 1;\n";

    expect(missingIn(["DEAD_NAME"], codeOf(src))).toEqual(["DEAD_NAME"]);
  });

  test("コードは残す", () => {
    expect(missingIn(["LIVE_NAME"], codeOf("const LIVE_NAME = 1; // 説明"))).toEqual([]);
  });
});

describe("missingIn", () => {
  test("在るものは返さない", () => {
    expect(missingIn(["running_clock"], "fn running_clock(&self)")).toEqual([]);
  });

  // 接頭辞を足す改名。部分一致で見ると素通りする
  test("別の識別子の一部としては数えない", () => {
    expect(missingIn(["WRITE_TIMEOUT"], "const STOP_WRITE_TIMEOUT: Duration")).toEqual([
      "WRITE_TIMEOUT",
    ]);
  });

  // **接尾辞側も見る。** 前置だけを与えると、語境界を片側しか要求しない形でも通る ——
  // `\b` の後ろ側を落とす1文字の変異がそれ。
  // この対は現物から採っている: `docs/proposals/naming-and-module-layout.md` が
  // `config_write` を挙げ、`src/entities/file-tree/api/error.ts` にあるのは
  // `config_write_failed`。**接尾辞が付いた側だけが実在する**形そのもの
  test("接尾辞を足した別の識別子としては数えない", () => {
    expect(missingIn(["config_write"], 'case "config_write_failed":')).toEqual(["config_write"]);
  });

  test("無いものだけ返す", () => {
    expect(missingIn(["running_clock", "elapsed_ms"], "fn running_clock(&self)")).toEqual([
      "elapsed_ms",
    ]);
  });
});
