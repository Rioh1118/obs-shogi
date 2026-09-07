import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./walk";

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

/** 画面の分岐が返す文言と、それが載るべき仕様書。 */
const SCREENS: { source: string; spec: string }[] = [
  {
    source: "src/features/settings/ui/tabs/WorkspaceTab.tsx",
    spec: "docs/spec/screens/settings.md",
  },
  {
    source: "src/features/position-search/ui/PositionSearchStatusBar.tsx",
    spec: "docs/spec/screens/position-search.md",
  },
];

/** `case "…": return "文言";` の文言だけを拾う。 */
function labelsOf(source: string): string[] {
  const text = readFileSync(join(REPO_ROOT, source), "utf8");
  const out: string[] = [];
  // `label: "…"` と `return "…";` の両方。どちらも画面に出る文字列
  for (const m of text.matchAll(/(?:label:|return)\s*"([^"]{4,})"/g)) {
    out.push(m[1]);
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

  /** 走査が空振りしたのを緑と読まない。 */
  it("文言を1つも拾えていないなら、それは走査の失敗", () => {
    for (const { source } of SCREENS) {
      expect(labelsOf(source).length, `${source} から文言を拾えていない`).toBeGreaterThan(3);
    }
  });
});
