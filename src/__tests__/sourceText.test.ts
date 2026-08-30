import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * `codeOf` の振る舞いと、それを持ち主の外に書き直させないことを固定する。
 *
 * 綴りを探すラチェットは、まず本文からコメントを落とす。この前処理が
 * 消しすぎると**違反があっても緑になる**ので、検査そのものより静かに壊れる。
 */

describe("codeOf", () => {
  test("行コメントとブロックコメントを落とす", () => {
    expect(codeOf("const a = 1; // note\n/* block */\nconst b = 2;")).toContain("const a");
    expect(codeOf("// only\nconst b = 2;")).not.toContain("only");
  });

  test("複数行のブロックを閉じるまで落とす", () => {
    const body = ["/**", " * makeKifuCursor を説明する", " */", "const a = 1;"].join("\n");

    expect(codeOf(body)).not.toContain("makeKifuCursor");
    expect(codeOf(body)).toContain("const a = 1;");
  });

  /**
   * 素の `String.replace` で落としていた頃に壊れた形。文字列リテラルの中の
   * `/` と `*` の並びが、離れた閉じと組になって間のコードを飲み込んでいた。
   */
  test("文字列リテラル中のブロック開始でコードを飲み込まない", () => {
    const body = ['const p = "icons/*.png";', 'const glyph = "☗";', "/** 閉じ */"].join("\n");

    expect(codeOf(body)).toContain("☗");
  });

  /**
   * 行頭 `*` を無条件に落としていた頃に壊れた形。演算子を行頭に置く整形と
   * 名前空間 import を組み合わせると、綴りが検査から消えていた。
   */
  test("ブロックの外の行頭 * はコードとして残す", () => {
    const body = ["const x =", "  1", "  * C.makeKifuCursor(0, [], k).tesuu;"].join("\n");

    expect(codeOf(body)).toContain("makeKifuCursor");
  });

  test("末尾コメントは落とすが、左のコードは残す", () => {
    const line = "const c = makeKifuCursor(1, [], p); // 直に呼ばないこと";

    expect(codeOf(line)).toContain("makeKifuCursor(1");
    expect(codeOf(line)).not.toContain("直に呼ばないこと");
  });

  // 行ごと捨てていた頃に素通りした形
  test("ブロックの閉じの右にあるコードは残す", () => {
    expect(codeOf("/* 説明\n*/ export const bad = makeKifuCursor(0, [], k);")).toContain(
      "makeKifuCursor",
    );
  });

  test("1行で開閉したブロックの右にあるコードは残す", () => {
    expect(codeOf("/* 一覧を組むだけ */ const c = makeKifuCursor(1, [], p);")).toContain(
      "makeKifuCursor",
    );
  });
});

/** コメント除去を自前で書いている検査を見つける綴り */
const HAND_ROLLED = /replace\(\s*\/\\\/\\\*/;

describe("コメント除去の持ち主", () => {
  // 自前で書き直すと、片方だけが「文字列リテラルで壊れる」形のまま残る。
  // 同じ取り違えが3本で起きたので、綴りの側で止める。
  test("検査は自前のコメント除去を持たない", () => {
    const offenders = tsFiles(SRC, { includeTests: true })
      .map((path) => relative(REPO_ROOT, path))
      .filter((rel) => rel.startsWith("src/__tests__/"))
      .filter((rel) => HAND_ROLLED.test(readFileSync(rel, "utf8")))
      .sort();

    expect(offenders, "`sourceText.ts` の codeOf を使うこと").toEqual([]);
  });
});
