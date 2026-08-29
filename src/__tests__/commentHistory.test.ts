import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * コメントに**変更の経緯**を書かない（`CONTRIBUTING.md` の「コメントの書き方」）。
 *
 * 読み手はその変更を書いた人ではない。「元は何だったか」「どのレビューで出たか」は
 * マージした時点で指すものが消え、残るのは辿れない参照だけになる。
 * 経緯は git log と PR に残る。コードには**現在どうあるべきか**だけを書く。
 *
 * `docs/` と `.claude/` は対象外。あちらは経緯を残す場所。
 */

const ROOTS = [join(process.cwd(), "src"), join(process.cwd(), "src-tauri", "src")];

/**
 * 経緯にしか出てこない語。**「なぜ」を書くのに要らないものだけ**を並べる。
 * 増やすときは、これ無しでは書けない「なぜ」が本当に無いかを確かめること
 */
const HISTORY_WORDS = [
  "今回",
  "PR #",
  "で対応",
  "ラウンド",
  "この差分",
  "同じ差分",
  "差分の外",
  "に変更した",
  "から変えた",
];

/**
 * ブランチ名。マージすると消えるので、コードから指してはいけない。
 * パスと紛れないよう `<type>/<数字>` と `issue-<数字>/` の形だけを見る
 */
const BRANCH_NAME = /(?:\b(?:fix|feat|chore|docs|refactor|perf|ci)\/\d|\bissue-\d+\/)/;

/** `//` 行コメントと `/* *\/` ブロックコメント。文字列の中は見ない（誤検出しても直せる形で出す） */
const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|rs|scss)$/.test(entry.name) ? [path] : [];
  });
}

describe("コメント", () => {
  it("変更の経緯を書いていない", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        const name = relative(process.cwd(), file);

        for (const match of source.matchAll(COMMENT)) {
          const text = match[0];
          const hit = HISTORY_WORDS.find((word) => text.includes(word));
          const branch = text.match(BRANCH_NAME)?.[0];
          if (!hit && !branch) continue;

          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${name}:${line}  「${hit ?? branch}」  ${text.slice(0, 70).trim()}`);
        }
      }
    }

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
