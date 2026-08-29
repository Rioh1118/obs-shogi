import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `AsyncResult` を返す関数は**投げない**。戻り値を読まないと、失敗は
 * どこにも出ないまま次の行へ進む。
 *
 * 捨てると、別の理由の警告だけが画面に出る形になりやすい。
 * フォルダを作れなかったのに「中身が未検出です」と出れば、
 * 利用者は「まだ置いていないだけ」と読む。
 *
 * 構文解析はしない。**式文としての `await f(...)`**（結果を代入も分岐もしない形）
 * だけを見る。`if (!res.success)` を書かせるところまでは見ない。
 *
 * 読まないのが正しい呼び出しもある（呼び先が自分で `state.error` に積む場合）。
 * その1行に `// async-result-ignored: <理由>` を付けると外れる。
 * 印を付ける変更は差分としてレビューに出る。
 */

const SRC = join(process.cwd(), "src");

/** 宣言の戻り値に `AsyncResult` が現れる関数名 */
const DECLARES_ASYNC_RESULT = /(?:function\s+|const\s+)(\w+)[^\n]*?:\s*AsyncResult</g;

/** 読まないのが正しいときの印。理由を書かせるので `:` まで含めて要求する */
const IGNORE_MARKER = "async-result-ignored:";

/**
 * 行頭から始まる `await f(` / `void await f(` / `void f(`。
 * 代入も `return` も付いていない＝結果を読みようがない形。
 *
 * `void f(` を落とすと、`await` を消すだけで検査を抜けられる
 */
function bareCallOf(names: Set<string>): RegExp {
  const call = `(?:\\w+\\.)?(${[...names].join("|")})`;
  return new RegExp(`^[ \\t]*(?:void await |void |await )${call}\\([^\\n]*`, "gm");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("AsyncResult の戻り値", () => {
  it("結果を読まずに呼んでいる箇所が無い", () => {
    const files = sourceFiles(SRC);
    const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

    const names = new Set<string>();
    for (const source of sources.values()) {
      for (const match of source.matchAll(DECLARES_ASYNC_RESULT)) names.add(match[1]);
    }
    expect(
      names.size,
      "AsyncResult を返す関数が1つも見つからない。検査が空振りしている",
    ).toBeGreaterThan(5);

    const pattern = bareCallOf(names);
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      const name = relative(process.cwd(), file);
      for (const match of source.matchAll(pattern)) {
        if (match[0].includes(IGNORE_MARKER)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${name}:${line}  ${match[0].trim()}`);
      }
    }

    expect(
      offenders,
      [
        "AsyncResult を返す関数の戻り値を読んでいない。",
        "これらは投げないので、失敗はどこにも出ないまま次の行へ進む。",
        `読まないのが正しいなら、その行に // ${IGNORE_MARKER} <理由> を付けること。`,
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
