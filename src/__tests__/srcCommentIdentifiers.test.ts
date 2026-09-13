import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { commentsOf } from "./sourceText";
import { identifiersIn, missingIdentifiers } from "./docsIdentifiers";
import { missingPaths, sourcePathsIn } from "./docsSourcePaths";

/**
 * `src/` のコメントがバッククォートで指す識別子が、ソースに実在するかを見る。
 *
 * **同じ形の検査が4つある。** Rust のコメントは `comment_identifiers`
 * （`src-tauri/tests/`）、doc は `docsIdentifiers`（範囲は `docsSourcePaths.ts` の
 * `scannedDocs`）、`src/**` の TS コメントと `.claude/` のハーネスはここ。この穴に落ちた腐りは、**コメントが「なぜこう書くか」の根拠として
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

  // 0件を見て緑になる形を止める
  test("コメントからパスを拾えている", () => {
    expect(scanned().flatMap((file) => sourcePathsIn(file.comments)).length).toBeGreaterThan(10);
  });

  /**
   * **パスで指す形は `docsIdentifiers` が自分から誘導している**——「検査の名前を
   * `EXEMPT` に足さないこと。指したいならパスで書く」。誘導した先が無検査だと、
   * 検査を1本改名した人が `src/` 側の参照を探す手掛かりを持たない。
   *
   * 判定は `docsSourcePaths` から借りる。写すと、穴が見つかったとき直るのが片方だけになる。
   */
  test("ソースに無いパスを指していない", () => {
    const broken = scanned().flatMap((file) =>
      missingPaths(sourcePathsIn(file.comments)).map((p) => `${file.name}: ${p}`),
    );

    expect(broken, "コメントが指すパスが消えている。移したらコメントも直すこと").toEqual([]);
  });

  /**
   * **ハーネス（`.claude/agents` / `.claude/skills` の `.md` と `.claude/hooks/*.sh`）も
   * 同じ網に入れる。** `.sh` は `commentsOf(..., "shell")` を通す（`.md` は本文そのまま）。
   *
   * reviewer の定義と手順書は、識別子を「これを grep して数えろ」という**材料**として
   * 名指す。腐ると reviewer は空振りし、何を探せばよいか分からないまま節を飛ばす
   * ——赤くならないので、飛ばしたことも残らない。
   *
   * `docs/` でも `src/` でもないので、既存の3本はどれもここを歩かない。
   */
  const harness = (): { name: string; comments: string }[] => {
    const walk = (rel: string): string[] =>
      readdirSync(join(REPO_ROOT, rel), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${rel}/${e.name}`)
          : e.name.endsWith(".md")
            ? [`${rel}/${e.name}`]
            : [],
      );
    const md = [...walk(".claude/agents"), ...walk(".claude/skills")].map((rel) => ({
      name: rel,
      comments: readFileSync(join(REPO_ROOT, rel), "utf8"),
    }));

    // hooks のコメントは検査の名前やパスを「仕様として引く」ので、見る側をここに置く。
    // corpus 側（`docsIdentifiers` の `hookCorpus`）は同じディレクトリを別に読む。
    const sh = readdirSync(join(REPO_ROOT, ".claude/hooks"), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".sh"))
      .map((e) => `.claude/hooks/${e.name}`)
      .map((rel) => ({
        name: rel,
        comments: commentsOf(readFileSync(join(REPO_ROOT, rel), "utf8"), "shell"),
      }));

    return [...md, ...sh];
  };

  // 0件を見て緑になる形を止める
  test("ハーネスから識別子を拾えている", () => {
    expect(harness().flatMap((f) => identifiersIn(f.comments)).length).toBeGreaterThan(10);
  });

  /**
   * **宣言を挟まずに `/** … *\/` が2枚続く形**を止める。
   *
   * TS は直前のブロックだけを宣言に結び付けるので、口を1つ足すときに doc の
   * 並べ替えを忘れると、**前の宣言の doc が新しい宣言に付く**——エディタの
   * ホバーも `cargo doc` にあたる読み方も、まるごと別の関数の説明を出す。
   * 危険な口ほど doc が厚いので、取り残されるのも危険な口のほうになる。
   *
   * **見るのは、間に空行も無く2枚続く形だけ。** それは doc を動かし忘れた形で、
   * 曖昧さが無い。
   *
   * **空行を1行挟んだ形は見ない。** ファイルの頭の doc も、節の区切りに置いた
   * 覚え書きも同じ見た目になり、取り残しと区別できない——**そこは人が読む。**
   * 逃げ道として使えることを承知で狭めてある。
   */
  test("空行も挟まずに doc ブロックが2枚続いていない", () => {
    const orphans = tsFiles(SRC, { includeTests: true })
      .map((path) => ({ name: relative(REPO_ROOT, path), body: readFileSync(path, "utf8") }))
      .flatMap((f) =>
        [...f.body.matchAll(/\*\/\n[ \t]*\/\*\*/g)].map(
          (m) => `${f.name}:${f.body.slice(0, m.index).split("\n").length}`,
        ),
      )
      .sort();

    expect(
      orphans,
      "doc ブロックが2枚続いている。口を足したなら doc も一緒に動かすこと",
    ).toEqual([]);
  });

  test("ハーネスがソースに無い識別子を指していない", () => {
    const broken = harness().flatMap((f) =>
      missingIdentifiers(identifiersIn(f.comments)).map((name) => `${f.name}: ${name}`),
    );

    expect(
      broken,
      "reviewer の定義が指す名前が消えている。材料として grep させる綴りなので、腐ると黙って空振りする",
    ).toEqual([]);
  });
});
