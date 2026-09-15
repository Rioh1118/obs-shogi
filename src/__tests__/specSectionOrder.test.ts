import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { REPO_ROOT } from "./walk";

/**
 * `docs/spec/screens/*.md` が、画面仕様として読める形で終わっているか。
 *
 * **見るのは端だけ。** 真ん中の節は画面ごとに違ってよい ——
 * タブを持つ画面はタブごとに節を立てるし、表示モードを持つ画面はその節を持つ。
 * 全画面に同じ並びを強いると、書ける形が1つしか無くなって嘘の節が生える。
 *
 * 端を見るのは、**そこに「無いもの」が書いてあるから**。
 * `いま満たしていないこと` と `これからの要件` は、この仕様書が
 * **現物と食い違っていないことの根拠**になっている唯一の節で、
 * 落ちた人が「これは未実装なのか不具合なのか」を判じる場所でもある。
 * 節ごと消えると、**書いていないことが「できる」と読まれる。**
 *
 * 末尾に置くことまで縛るのは、後ろに節を足されると
 * 「ここから先は未実装」の線が引けなくなるため。
 */

const SCREENS = join(REPO_ROOT, "docs/spec/screens");

/** 必ずこの順で、**この2つが最後**に来ること */
const TAIL = ["いま満たしていないこと", "これからの要件"] as const;

/** 冒頭。**誰が何のために開くか**が無い仕様書は、画面の索引として使えない */
const HEAD = "目的";

/**
 * 冒頭の `目的` を持たなくてよいもの。
 *
 * `system-dialogs.md` は**画面1枚の仕様ではない**（衝突・読み込み失敗・更新・確認の
 * 4つを束ねている）。目的は4つあるので、1つに畳むと必ずどれかの嘘になる。
 * 代わりに `共通の決まり` から始めて、以降を1つずつの節で書いている。
 */
const HEAD_EXEMPT = new Set(["system-dialogs.md"]);

/** 走査が壊れて0件になったことを「違反が無い」と読ませないための下限 */
const MIN_SCANNED = 10;

function specFiles(): string[] {
  return readdirSync(SCREENS)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/** `## ` の見出しだけ。`### ` 以下は画面の中の細目なので数えない */
function headingsOf(name: string): string[] {
  const body = readFileSync(join(SCREENS, name), "utf8");
  return [...body.matchAll(/^## (.+)$/gm)].map((found) => found[1].trim());
}

describe("画面仕様の節", () => {
  test("走査が仕様書を見つけている", () => {
    // **「違反0件」と「見たファイル0件」を区別する**
    expect(specFiles().length).toBeGreaterThan(MIN_SCANNED);
  });

  test("「いま満たしていないこと」→「これからの要件」で終わっている", () => {
    const offences = specFiles()
      .map((name) => ({ name, tail: headingsOf(name).slice(-TAIL.length) }))
      .filter(({ tail }) => tail.join(" / ") !== TAIL.join(" / "))
      .map(({ name, tail }) => `${name}  末尾: ${tail.join(" / ") || "（見出しが無い）"}`);

    expect(
      offences,
      "画面仕様の末尾が `## いま満たしていないこと` → `## これからの要件` になっていない。" +
        "この2つは**書いていないことが「できる」と読まれない**ための節で、" +
        "後ろに節を足すと「ここから先は未実装」の線が引けなくなる。" +
        "**無い画面には「無い」と書くこと**（節ごと消さない）",
    ).toEqual([]);
  });

  test("「目的」から始まっている", () => {
    const offences = specFiles()
      .filter((name) => !HEAD_EXEMPT.has(name))
      .filter((name) => headingsOf(name)[0] !== HEAD)
      .map((name) => `${name}  冒頭: ${headingsOf(name)[0] ?? "（見出しが無い）"}`);

    expect(
      offences,
      "画面仕様が `## 目的` から始まっていない。誰が何のために開くかが無いと、" +
        "`docs/spec/README.md` の一覧から辿った人が**この画面かどうかを判じられない**。" +
        "1枚の画面に畳めない仕様書なら `HEAD_EXEMPT` へ、**なぜ目的が1つに書けないかを書いて**足すこと",
    ).toEqual([]);
  });
});
