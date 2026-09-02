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
 * レビューが振った識別子も止める。付いた時点では意味があるが、
 * 指す先はレビューが終われば消える。
 *
 * **このファイル自身も走査の対象。** 止めたい形は下の `HISTORY_WORDS` と
 * `REVIEW_TAG` に**リテラルとして**書くこと。文章で例示すると自分で落ちる。
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
  "時期があ",
];

/**
 * **止めているのは上にリテラルで並べた語だけ。言い換えは通る。**
 * 網を広く見積もらないこと。広いと思うと、語を足す判断が働かなくなる。
 *
 * `だった` と `元は` を入れていないのは、前者が「読み込み中だったら」、
 * 後者が「呼び出し元は」のように、いまの状態を書くのにも出るため。
 * 同じ理由で「〜ていなかった」も入れていない（値がその時点でどうかを
 * 書くのに出る。現物で試すと該当4件のうち3件が誤検出だった）。
 *
 * 設計を説明したくなったら「〜が引き取る」「〜へ回す」と現在形で書く
 */

/**
 * 指す先の消えたレビュー識別子。番号付きの箇条書き、括弧に入れた観点と番号、
 * レビューの回次を指す矢印の3つ。
 *
 * どれも `.claude/reviews/` にしか存在しない採番なので、リポジトリを
 * 読むだけの人には何も指していない。issue の `→ #123` とは衝突しない。
 *
 * 形は正規表現そのものを読むこと。ここに例を書くと自分で落ちる
 */
const REVIEW_TAG = /^\s*\/\/\s*\d+:|\([A-Z]-[A-Z]?\d+\)|→\s*r\d+|\br\d+\s*→\s*r\d+/;

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
