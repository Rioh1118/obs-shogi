import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { REPO_ROOT, SRC, sourceFiles } from "./walk";

/**
 * **画面が出す語が、その画面の仕様書に載っているか。**
 *
 * `docs/spec/screens/` は「いま何ができて、何ができないか」を読む唯一の入口。
 * 画面に文言を足しても仕様書が追わないと、次の実装が**消えた行を新機能として
 * 設計し直す**。`IndexHealth` は値が増えやすく、増えた分だけ3画面に文言が要る
 * ——**画面を触った人が仕様書を開かない**のが普通なので、機械で止める。
 *
 * **見るのは文言の実在だけ。** 説明が正しいかは人が読む
 * （`docs/state-transitions/` 側のラチェットと同じ線引き）。
 */

/**
 * `src/features` 以下の画面ファイル。
 *
 * `SCREENS` の漏れを見るためだけに歩く。**空振りを緑と読まない**よう、
 * 呼び手が件数を確かめる。
 */
function uiFiles(): string[] {
  // **`src` 全体を歩く。** レイヤ規則は `widgets` / `pages` が
  // `indexHealth` を読むことを禁じていない。`features` だけだと、
  // そこへ移した瞬間に検査から外れる
  //
  // **テストと `entities/search` 自身は除く。** 前者はテストが型を import した
  // 瞬間に「SCREENS に載せろ」と落ちて**テストを画面として登録する誤り**へ
  // 誘導する。後者は具合を決める側であって、画面ではない
  return sourceFiles(SRC, { includeTests: false })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => relative(REPO_ROOT, f))
    .filter((f) => !f.startsWith("src/entities/search/"));
}

/**
 * 画面の分岐が返す文言と、それが載るべき仕様書。
 *
 * **`IndexHealth` で分岐する画面を全部入れること。**
 * 漏れは同じファイルの「IndexHealth で分岐する画面は全部 SCREENS に載っている」が見る。
 */
const SCREENS: { source: string; spec: string }[] = [
  {
    source: "src/features/settings/ui/tabs/WorkspaceTab.tsx",
    spec: "docs/spec/screens/settings.md",
  },
  {
    source: "src/features/position-search/ui/PositionSearchStatusBar.tsx",
    spec: "docs/spec/screens/position-search.md",
  },
  {
    source: "src/features/position-search/ui/PositionSearchHitList.tsx",
    spec: "docs/spec/screens/position-search.md",
  },
  {
    source: "src/features/position-search/ui/PositionSearchModal.tsx",
    spec: "docs/spec/screens/position-search.md",
  },
];

/**
 * 画面に出る文字列リテラルを拾う。
 *
 * **拾うのは3つの形だけ。** `label: "…"`、`return "…"`、**両腕とも文字列
 * リテラルの三項**（`cond ? "A" : "B"`）。三項を拾うのは、`return` だけだと
 * `emptyReason` の `ok` の腕が漏れるから。
 *
 * **見ていないもの。** 入れ子三項（腕の片方が識別子）と JSX の地の文
 * （`ほか N 件` など）。どちらもここでは拾わないので、**その文言が
 * 仕様書に載っているかは人が読む**。
 *
 * 下限を2文字にしてあるのは、`未作成` のような3文字のバッジを落とさないため。
 */
function labelsOf(source: string): string[] {
  const text = readFileSync(join(REPO_ROOT, source), "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:label:|return)\s*"([^"]{2,})"/g)) {
    out.push(m[1]);
  }
  // 三項の両腕。`:` を単独で拾うと `tone: "muted"` のような**画面に出ない値**まで来る
  for (const m of text.matchAll(/\?\s*"([^"]{2,})"\s*:\s*"([^"]{2,})"/g)) {
    out.push(m[1], m[2]);
  }
  return out;
}

describe("画面の文言と仕様書", () => {
  for (const { source, spec } of SCREENS) {
    it(`${source} が出す文言は ${spec} に載っている`, () => {
      const specText = readFileSync(join(REPO_ROOT, spec), "utf8");
      const missing = labelsOf(source).filter((l) => !specText.includes(l));

      expect(
        missing,
        `画面に足した文言が仕様書に無い。**同じ PR で仕様書も直すこと**\n` +
          `（CLAUDE.md「触った画面の仕様が現物と違うようになったら、同じ PR で直す」）`,
      ).toEqual([]);
    });
  }

  /**
   * **`IndexHealth` で分岐する画面が `SCREENS` に全部載っていること。**
   *
   * 載せ漏らすと、その画面だけ仕様書を触らずに文言を足せる——ラチェットが
   * 止めようとしている事故が、載っていない面で素通りする。
   */
  it("IndexHealth で分岐する画面は全部 SCREENS に載っている", () => {
    const listed = new Set(SCREENS.map((s) => s.source));
    const all = uiFiles();
    expect(all.length, "`src/features` を歩けていない").toBeGreaterThan(10);

    // **型名だけを見ない。** 型注釈を書かずに `indexHealth()` の返り値で
    // 分岐する画面は、`IndexHealth` の綴りをファイルに1つも持たない
    // ——値だけで分岐する形が、いちばん普通の書き方
    const branching = all.filter((f) => {
      const text = readFileSync(join(REPO_ROOT, f), "utf8");
      return /\bIndexHealth\b/.test(text) || /\bindexHealth\s*\(/.test(text);
    });
    expect(branching.filter((f) => !listed.has(f))).toEqual([]);
  });

  /** 走査が空振りしたのを緑と読まない。 */
  it("文言を1つも拾えていないなら、それは走査の失敗", () => {
    for (const { source } of SCREENS) {
      expect(labelsOf(source).length, `${source} から文言を拾えていない`).toBeGreaterThan(3);
    }
  });
});
