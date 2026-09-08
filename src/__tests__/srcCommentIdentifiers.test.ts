import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { commentsOf } from "./sourceText";
import { identifiersIn, missingIdentifiers } from "./docsIdentifiers";

/**
 * `src/` のコメントがバッククォートで指す識別子が、ソースに実在するかを見る。
 *
 * **同じ形の検査が3つある。** Rust のコメントは `comment_identifiers`
 * （`src-tauri/tests/`）、doc は `docsIdentifiers`（範囲は `docsSourcePaths.ts` の
 * `scannedDocs`）、`src/**` の TS コメントはここ。この穴に落ちた腐りは、**コメントが「なぜこう書くか」の根拠として
 * 名指した関数が消えている**という形で出る——読み手はその名前を grep して
 * 空振りし、根拠を確かめられないまま「たぶん古い注意書きだろう」と判断する。
 * 消したはずの条件をもう一度書く番になったとき、止める者が居ない。
 *
 * **判定は `docsIdentifiers` から借りる。** 拾う綴りの規則（`IDENTIFIER`）も、
 * 実在の corpus も、免除の一覧も向こうが持つ。こちらが決めるのは走査範囲だけ。
 *
 * **`__tests__` を外す。** テストのコメントは「もう無い名前を捕まえられること」を
 * 説明する用途で書かれるうえ、corpus 自身がテストを外している（`docsIdentifiers.ts`）
 * ので、含めると自分の期待値を根拠に緑を返す形が混ざる。
 *
 * **SCSS は見ない。** あちらのコメントが引くのは CSS のプロパティ名と SCSS の変数で、
 * `IDENTIFIER` は `minHeight` のような綴りをそのまま識別子として拾う。掛けるなら
 * その語彙のための免除が別に要る。
 *
 * 止められるのは `docsIdentifiers` と同じ範囲——**綴りが1つも残っていない名前だけ**。
 * 別の場所に同じ綴りが在る改名や、型名・バリアント名は素通りする。
 */
describe("`src/` のコメントが指す識別子", () => {
  const scanned = () =>
    tsFiles(SRC, { includeTests: false }).map((path) => ({
      name: relative(REPO_ROOT, path),
      comments: commentsOf(readFileSync(path, "utf8")),
    }));

  // 0件を見て緑になる形を止める
  test("コメントから識別子を拾えている", () => {
    const found = scanned().flatMap((file) => identifiersIn(file.comments));

    expect(found.length).toBeGreaterThan(50);
  });

  test("ソースに無い識別子を指していない", () => {
    const broken = scanned().flatMap((file) =>
      missingIdentifiers(identifiersIn(file.comments)).map((name) => `${file.name}: ${name}`),
    );

    expect(
      broken,
      "コメントが指す名前が消えている。改名したらコメントも直すこと。落とすなら理由ごと書き直すこと",
    ).toEqual([]);
  });
});
