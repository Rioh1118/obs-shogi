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

describe("codeOf（shell）", () => {
  // `docsIdentifiers` が `.claude/hooks/*.sh` を走査する。既定の `//` では
  // シェルのコメントが1つも落ちないので、綴りを説明した行が実装に見える
  test("`#` のコメントを落とす", () => {
    expect(
      codeOf("# CLAUDE_PROJECT_DIR は使っていない\ngate_flatten() {\n", "shell"),
    ).not.toContain("CLAUDE_PROJECT_DIR");
  });

  // **2行目以降の、字下げの無い行頭。** hooks の行頭コメント224行のうち198行がこの形
  // （残り26行は字下げがあるので `[ \t]` 枝）。ここが落ちないと消した名前が
  // corpus に残って「実在する」に戻る。
  // しかも壊れる向きは「消し足りない」側で、`missingIdentifiers` は黙って緑になる
  test("行頭の `#` は2行目以降でも落とす", () => {
    // **2つ置く。** 1つだと `g` を外しても最初の1つが落ちて緑になる ——
    // その変異は `missingIdentifiers` の答えを変える（消した名前が実在に戻る）
    const body = "needs_ts=1\n# OLD_NAME のこと\nneeds_rust=1\n# OTHER_NAME のこと\ndone\n";

    expect(codeOf(body, "shell")).not.toContain("OLD_NAME");
    expect(codeOf(body, "shell")).not.toContain("OTHER_NAME");
    expect(codeOf(body, "shell")).toContain("needs_rust=1");
  });

  test("行頭が `#` でないコード行は残す", () => {
    expect(codeOf("gate_kinds_for_path() {\n", "shell")).toContain("gate_kinds_for_path");
  });

  // `//` を落とすと本物のコードが消える
  test("`//` を含むコード行を切らない", () => {
    expect(codeOf("sed -E 's/x//' | tr a b\n", "shell")).toContain("tr a b");
  });

  // 行末に書いた名前が corpus に残ると、消したものが「実在する」に戻る
  test("行末の `#` も落とす", () => {
    expect(codeOf("needs_ts=1  # OLD_NAME のこと\n", "shell")).not.toContain("OLD_NAME");
    expect(codeOf("needs_ts=1  # OLD_NAME のこと\n", "shell")).toContain("needs_ts=1");
  });

  // 落としても困らないが、落とす理由も無い。**「残す」と書いた以上は固定する**
  test("shebang は残す", () => {
    expect(codeOf("#!/usr/bin/env bash\nneeds_ts=1\n", "shell")).toContain("/usr/bin/env");
  });

  // **語の途中の `#` は展開。** 切ると本物のコードが消える
  test("語の途中の `#` は切らない", () => {
    expect(codeOf("kinds=${kinds# }\n", "shell")).toContain("${kinds# }");
    expect(codeOf("if [ $# -eq 0 ]\n", "shell")).toContain("$#");
  });

  // **文字列を先に潰す順を固定する。** 逆順だと引用符の中の ` # ` を先に切るので、
  // 行の後半が corpus から消え（実在する識別子が「無い」になる）、
  // 引用符の中の名前は残る（検査の期待値がソースに見える）。両方向に壊れる
  test("引用符の中の `#` でコメントが始まらない", () => {
    // 単引用も2つ置く（理由は上と同じ）
    const line = "grep 'gate_x # y' file 'gate_z # w' tail\n";

    expect(codeOf(line, "shell")).toContain("tail");
    expect(codeOf(line, "shell")).not.toContain("gate_x");
    expect(codeOf(line, "shell")).not.toContain("gate_z");
  });

  // 検査の期待値が実装に見えると、消したものが「実在する」に戻る
  test("引用符の中の名前は数えない", () => {
    const line = 'expect_kinds "ts rust" "src-tauri/tests/root_guard.rs"\n';

    expect(codeOf(line, "shell")).not.toContain("root_guard");
    expect(codeOf(line, "shell")).toContain("expect_kinds");
  });

  // **空の `""` も1つの引用として食う。** 食わないと組が1つずれ、
  // 隣の引用の中身がまるごと残る。`verify-gate.test.sh` は空を第1引数に置く形を
  // 実際に使っているので、ずれた側が corpus に混ざって「実在する」に戻る
  test("空の引用符も落とす", () => {
    const line = 'expect_dir "" "GIT_DIR=$target/.git git commit -m x" "$here"\n';

    expect(codeOf(line, "shell")).not.toContain("GIT_DIR");
    expect(codeOf(line, "shell")).toContain("expect_dir");
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
