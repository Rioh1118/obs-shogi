import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, RUST_SRC, SRC, sourceFiles } from "./walk";

/**
 * コメントに**変更の経緯**を書かない（`CONTRIBUTING.md` の「コメントの書き方」）。
 *
 * 読み手はその変更を書いた人ではない。「元は何だったか」「どのレビューで出たか」は
 * マージした時点で指すものが消え、残るのは辿れない参照だけになる。
 * 経緯は git log と PR に残る。コードには**現在どうあるべきか**だけを書く。
 *
 * 見るのは下の `ROOTS`（アプリと Rust のソース、Rust の検査）。`docs/` と
 * `.claude/` は経緯を残す場所なので入れない。設定ファイル類は入れていない。
 *
 * レビューの識別子（`// 6:` / `(C-H1)`）も止める。付いた時点では意味があるが、
 * 指す先はレビューが終われば消える。
 */

const ROOTS = [SRC, RUST_SRC, join(REPO_ROOT, "src-tauri", "tests")];

/**
 * 経緯にしか出てこない語。**「なぜ」を書くのに要らないものだけ**を並べる。
 * 増やすときは、これ無しでは書けない「なぜ」が本当に無いかを確かめること
 */
const HISTORY_WORDS = [
  "今回",
  "PR #",
  "この PR",
  "で対応",
  "ラウンド",
  "この差分",
  "同じ差分",
  "差分の外",
  "に変更した",
  "から変えた",
  "残っていた",
  "旧来",
  "旧実装",
  "旧仕様",
  "以前",
  "かつて",
  "元々",
];

/**
 * `だった` と `元は` は入れない。前者は「読み込み中だったら」、後者は「呼び出し元は」
 * のように、いまの状態を書くのに出る。
 * `で対応` は形を問わず止める。設計の説明に使いたくなったら
 * 「〜が引き取る」「〜へ回す」と書く
 */

/** 指す先の消えたレビュー識別子。`// 6:` や `(C-H1)` のような形 */
const REVIEW_TAG = /^\s*\/\/\s*\d+:|\([A-Z]-[A-Z]?\d+\)/;

/**
 * ブランチ名。マージすると消えるので、コードから指してはいけない。
 * パスと紛れないよう `<type>/<数字>` と `issue-<数字>/` の形だけを見る
 */
const BRANCH_NAME = /(?:\b(?:fix|feat|chore|docs|refactor|perf|ci)\/\d|\bissue-\d+\/)/;

/** `//` 行コメントと `/* *\/` ブロックコメント。文字列の中は見ない（誤検出しても直せる形で出す） */
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

describe("コメント", () => {
  it("変更の経緯を書いていない", () => {
    const offenders: string[] = [];

    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        scanned += 1;
        // この検査自身は、止めたい形を例として書く場所
        if (file === __filename) continue;

        const source = readFileSync(file, "utf8");
        const name = relative(REPO_ROOT, file);

        for (const match of source.matchAll(COMMENT)) {
          const text = match[0];
          const hit = HISTORY_WORDS.find((word) => text.includes(word));
          const branch = text.match(BRANCH_NAME)?.[0];
          const tag = text.match(REVIEW_TAG)?.[0];
          if (!hit && !branch && !tag) continue;

          const line = source.slice(0, match.index).split("\n").length;
          const why = hit ?? branch ?? tag;
          offenders.push(`${name}:${line}  「${why}」  ${text.slice(0, 70).trim()}`);
        }
      }
    }

    // 走査が空振りしても「違反0」になる。歩けていることを別に固定する
    expect(scanned, `${scanned} ファイルしか歩けていない`).toBeGreaterThan(150);

    expect(
      offenders,
      [
        "コメントに変更の経緯が入っている。",
        "読み手はその変更を書いた人ではない。マージすると指すものが消える。",
        "いま何がどうあるべきかだけを書くこと。経緯は git log と PR に残る。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
