import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

/**
 * 棋譜を画面に開くのは tsshogi の `importCSA`。索引（Rust）は
 * **その受ける範囲を出ないように**綴りを整えており、その判定に
 * tsshogi の行パターンを使う。
 *
 * **パターンの持ち主は TS 側。** tsshogi を上げるのはこちらの仕事なので、
 * ずれたときに落ちるのもこちら。Rust はリポジトリに置いた fixture を読むだけにして、
 * `cargo test` が `node_modules` に依存しない形にしてある。
 *
 * fixture がずれていたらこのテストが落ちる。落ちたら:
 *
 * 1. `src-tauri/tests/fixtures/tsshogi_csa_patterns.json` を作り直す
 * 2. **Rust 側の `tidy_csa` を見直す** — 受ける範囲が変わったということは、
 *    整形してよい範囲も変わっている
 *
 * 1 だけやって 2 を飛ばすと、索引と画面で読める棋譜が食い違う。
 */
const FIXTURE = resolve(__dirname, "../../src-tauri/tests/fixtures/tsshogi_csa_patterns.json");
const TSSHOGI_CSA = resolve(__dirname, "../../node_modules/tsshogi/dist/esm/csa.mjs");

/** `pattern: /…/,` の並びから正規表現の中身だけを取り出す */
function patternsFromTsshogi(): string[] {
  const source = readFileSync(TSSHOGI_CSA, "utf8");
  return source
    .split("\n")
    .map((line) => /^pattern: \/(.*)\/,$/.exec(line.trim())?.[1])
    .filter((body): body is string => body !== undefined);
}

describe("tsshogi の CSA 行パターン", () => {
  test("fixture が、インストール済みの tsshogi と一致する", () => {
    const installed = patternsFromTsshogi();

    // 取り出せなくなったら黙って通さない。バンドラが1行に畳んだ場合など、
    // **書き方が変わったこと自体を知りたい**
    expect(
      installed.length,
      "tsshogi からパターンを取り出せなくなった。`csa.mjs` の書き方が変わった可能性がある",
    ).toBeGreaterThan(8);

    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { patterns: string[] };

    expect(
      fixture.patterns,
      "fixture が古い。作り直したうえで、Rust の `tidy_csa` が整形してよい範囲も見直すこと",
    ).toEqual(installed);
  });

  test("パターンが Rust の regex でも読める形になっている", () => {
    // Rust 側は `regex` クレートで当てる。JS だけの記法（先読みなど）が入ると
    // **Rust 側がコンパイルできずに落ちる**ので、こちらで先に気付く
    const jsOnly = /\(\?[=!<]/;
    for (const body of patternsFromTsshogi()) {
      expect(jsOnly.test(body), `Rust の regex が受けない記法が入った: /${body}/`).toBe(false);
    }
  });
});
