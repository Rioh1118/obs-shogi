import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync } from "node:fs";
import { REPO_ROOT, RUST_CHECKS_DIR, SRC, tsFiles } from "./walk";

/**
 * `CONTRIBUTING.md` の「機械で止めているもの」の表と、実在する検査を突き合わせる。
 *
 * あの表は「落ちたときの逃げ道はそれぞれ違います」と宣言している唯一の索引で、
 * 赤くなった人が最初に開く。**表に無い＝逃げ道が無い**とも読める。
 * 検査を足したのに載せ忘れると、`ALLOWED` のような逃げ道の存在に辿り着けない。
 *
 * 表と本体が食い違う形は2回起きている（検査を4本足して載せ忘れた回と、
 * 本体の判定を広げたのに行が前の姿のまま残った回）。人の注意では続かないので機械で見る。
 *
 * 見るのは**名前の対応だけ**。逃げ道の説明が現物と合っているかまでは見られない。
 */
const CONTRIBUTING = join(REPO_ROOT, "CONTRIBUTING.md");

/** 表の始まりと、次の見出し。この間だけを読む */
const SECTION = /### 機械で止めているもの\n([\s\S]*?)\n## /;

/** 表の1列目。`| \`name\` | ... |` の name */
const ROW = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`(?:（Rust）)?\s*\|/gm;

function listedChecks(): string[] {
  const body = readFileSync(CONTRIBUTING, "utf8");
  const section = SECTION.exec(body);

  expect(section, "CONTRIBUTING.md の「機械で止めているもの」の節が見つからない").not.toBeNull();

  return [...section![1].matchAll(ROW)].map((m) => m[1]).sort();
}

/** `src/` 側の検査。ファイル名から拡張子を落としたものを名前とする */
function existingChecks(): Set<string> {
  const names = tsFiles(SRC, { includeTests: true })
    .map((p) => relative(REPO_ROOT, p))
    .filter((p) => p.endsWith(".test.ts") || p.endsWith(".test.tsx"))
    .map((p) =>
      p
        .split("/")
        .pop()!
        .replace(/\.test\.tsx?$/, ""),
    );

  return new Set(names);
}

/**
 * Rust 側の検査。`listedChecks` と突き合わせるために名前で持つ。
 *
 * **ここと `CONTRIBUTING.md` の表の両方に載っていないと落ちる。**
 * 片方だけ人が覚える形にすると、忘れても何も起きない。
 */
const RUST_CHECKS = new Set([
  "comment_identifiers",
  "engine_layering",
  "engine_timeouts",
  "production_unwrap",
  "root_guard",
  "serde_naming",
  "state_transition_cells",
  "timeout_marker",
  "timeout_result",
]);

/** `src-tauri/tests/*.rs` のファイル名（拡張子を落としたもの） */
function rustChecks(): string[] {
  return readdirSync(RUST_CHECKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rs"))
    .map((entry) => entry.name.replace(/\.rs$/, ""))
    .sort();
}

/**
 * ラチェットではなく、**ラチェットが使う走査器の単体テスト**。表には載せない。
 *
 * 表の行はリポジトリ全体に掛かる検査と1対1で、`contrastRatchet` /
 * `scssScaleRatchet` がその側。ここに挙げた2本はその走査器の振る舞いを固定する。
 */
const SCANNER_TESTS = new Set(["contrast", "scssScale"]);

describe("CONTRIBUTING.md の検査の索引", () => {
  // 0件を見て緑になる形を止める
  test("表から名前を読めている", () => {
    expect(listedChecks().length).toBeGreaterThan(10);
  });

  test("表に載っている検査は実在する", () => {
    const existing = existingChecks();
    const missing = listedChecks().filter((n) => !existing.has(n) && !RUST_CHECKS.has(n));

    expect(missing, "表にあるが検査が無い。名前を直すか行を落とすこと").toEqual([]);
  });

  // 0件を見て緑になる形を止める
  test("Rust 側の検査を読めている", () => {
    expect(rustChecks().length).toBeGreaterThan(0);
  });

  test("`src-tauri/tests` の検査は表と RUST_CHECKS の両方に載っている", () => {
    const listed = new Set(listedChecks());
    const missing = rustChecks().filter((name) => !listed.has(name) || !RUST_CHECKS.has(name));

    expect(
      missing,
      "Rust の検査を足したら CONTRIBUTING.md の表（`（Rust）` 付き）と RUST_CHECKS の両方に足すこと",
    ).toEqual([]);
  });

  test("RUST_CHECKS に書いた名前は実在する", () => {
    const existing = new Set(rustChecks());
    const phantom = [...RUST_CHECKS].filter((name) => !existing.has(name)).sort();

    expect(phantom, "`src-tauri/tests/` に無い名前が RUST_CHECKS に残っている").toEqual([]);
  });

  test("`src/__tests__` の検査は表に載っている", () => {
    const listed = new Set(listedChecks());
    const unlisted = tsFiles(SRC, { includeTests: true })
      .map((p) => relative(REPO_ROOT, p))
      .filter((p) => p.startsWith("src/__tests__/") && p.endsWith(".test.ts"))
      .map((p) =>
        p
          .split("/")
          .pop()!
          .replace(/\.test\.ts$/, ""),
      )
      .filter((n) => !listed.has(n) && !SCANNER_TESTS.has(n))
      .sort();

    expect(unlisted, "検査を足したら CONTRIBUTING.md の表にも行を足すこと").toEqual([]);
  });
});
