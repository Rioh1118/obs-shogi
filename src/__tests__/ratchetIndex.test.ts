import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { checkName, existingChecks, rustChecks } from "./checkNames";

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

/**
 * 表の始まりと、**次の見出し**。この間だけを読む。
 *
 * **`###` で切ること。** `##` までにすると節を跨いで別の表まで読み、
 * 行が隣の表へ移っても名前が拾えて緑のまま通る（実際にマージで3行が
 * 隣の表へ落ち、列数が合わずに逃げ道の列が描画から消えていた）。
 */
const SECTION = /### 機械で止めているもの\n([\s\S]*?)\n##+ /;

/** 表の1列目。`| \`name\` | ... |` の name */
const ROW = /^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`(?:（Rust）)?\s*\|/gm;

function listedChecks(): string[] {
  const body = readFileSync(CONTRIBUTING, "utf8");
  const section = SECTION.exec(body);

  expect(section, "CONTRIBUTING.md の「機械で止めているもの」の節が見つからない").not.toBeNull();

  return [...section![1].matchAll(ROW)].map((m) => m[1]).sort();
}

/**
 * 索引に載せる義務が掛かるファイル。**置き場ではなく綴りで決める。**
 *
 * リポジトリ横断の検査は `src/__tests__/` に置くと決めてある（`vite.config.ts`）が、
 * **1ファイルの内部の形しか見ない走査**はスライス側に置く。置き場で見分けると、
 * スライスへ移した検査がその瞬間に索引の義務から外れる。
 * スライスに置くものは `*.ratchet.test.ts` / `.tsx` と名乗ること。
 *
 * **拡張子は `checkName` と同じ集合で見ること。** 片方だけ `.ts` に閉じると、
 * `.tsx` と名乗ったラチェットが索引の義務から丸ごと外れる——置き場の
 * `entities/analysis/model/__tests__/` は `.tsx` が多数派なので、周りに
 * 合わせた人がそのまま踏む。
 */
const hasIndexDuty = (p: string): boolean =>
  (p.startsWith("src/__tests__/") && /\.test\.tsx?$/.test(p)) || /\.ratchet\.test\.tsx?$/.test(p);

function ratchetFiles(): string[] {
  return tsFiles(SRC, { includeTests: true })
    .map((p) => relative(REPO_ROOT, p))
    .filter(hasIndexDuty);
}

/**
 * Rust 側の検査。`listedChecks` と突き合わせるために名前で持つ。
 *
 * **ここと `CONTRIBUTING.md` の表の両方に載っていないと落ちる。**
 * 片方だけ人が覚える形にすると、忘れても何も起きない。
 */
const RUST_CHECKS = new Set([
  "log_line_builders",
  "comment_identifiers",
  "engine_timeouts",
  "layering",
  "production_unwrap",
  "roots",
  "root_guard",
  "serde_naming",
  "scanning",
  "book_entry_shape",
  "state_table_terms",
  "state_transition_cells",
  "index_cache_guard_names",
  "index_writes_are_guarded",
  "search_doc_names",
  "temp_dir_names",
  "test_count_ratchet",
  "timeout_marker",
  "timeout_result",
]);

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

  // 0件を見て緑になる形を止める
  test("索引の義務が掛かるファイルを拾えている", () => {
    const found = ratchetFiles();

    expect(found.length).toBeGreaterThan(10);
    expect(
      found.filter((p) => /\.ratchet\.test\.tsx?$/.test(p)).length,
      "スライス側のラチェットを1本も拾えていない",
    ).toBeGreaterThan(0);
  });

  // 拾う側（`hasIndexDuty`）と名前を採る側（`checkName`）で拡張子の集合が割れると、
  // 片方の綴りだけが義務から外れる。**両方に同じ道を通す。**
  test("スライス側のラチェットは .ts と .tsx の両方が義務に入る", () => {
    for (const p of [
      "src/entities/x/__tests__/probe.ratchet.test.ts",
      "src/entities/x/__tests__/probe.ratchet.test.tsx",
    ]) {
      expect(hasIndexDuty(p), p).toBe(true);
      expect(checkName(p), p).toBe("probe");
    }

    // ラチェットを名乗らない隣人は巻き込まない
    expect(hasIndexDuty("src/entities/x/__tests__/probe.test.tsx")).toBe(false);
  });

  /**
   * 表の行が、見出しと同じ列数を持つこと。
   *
   * GFM は見出しより多いセルを捨てるので、**逃げ道の列が描画から消える**。
   * 表を跨いで行を動かすと必ずこの形になる。
   */
  test("表の行の列数が見出しと合っている", () => {
    const body = readFileSync(CONTRIBUTING, "utf8").split("\n");
    const offenders: string[] = [];

    let header = 0;
    for (const [at, line] of body.entries()) {
      if (!line.startsWith("|")) {
        header = 0;
        continue;
      }
      // **`\|` は数えない。** セルの中に縦棒を書く正しい綴りで、区切りではない
      const cells = line.replace(/\\\|/g, "").split("|").length;
      if (header === 0) header = cells;
      else if (/^\|[\s:|-]+\|$/.test(line)) continue;
      else if (cells !== header) offenders.push(`${at + 1}: ${line.slice(0, 40)}`);
    }

    expect(offenders, "表の行が見出しと違う列数を持っている（逃げ道の列が消える）").toEqual([]);
  });

  test("ラチェットは表に載っている", () => {
    const listed = new Set(listedChecks());
    const unlisted = ratchetFiles()
      .map((p) => checkName(p))
      .filter((n) => !listed.has(n) && !SCANNER_TESTS.has(n))
      .sort();

    expect(unlisted, "検査を足したら CONTRIBUTING.md の表にも行を足すこと").toEqual([]);
  });
});
