import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

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

/**
 * 宣言の戻り値に `AsyncResult` が現れる関数名。
 *
 * **行をまたげること。** この repo の主流の書き方は
 * `const f = useCallback(` で改行して次の行に `: AsyncResult<...> =>` なので、
 * 1行に閉じた正規表現だと `provider.tsx` の主要な関数が丸ごと外れる。
 * `;` `{` `}` を挟まない範囲に限って、別の宣言まで飲み込まないようにする
 */
const DECLARES_ASYNC_RESULT = /(?:function\s+|const\s+)(\w+)[^;{}]*?:\s*AsyncResult</g;

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

describe("AsyncResult の戻り値", () => {
  it("結果を読まずに呼んでいる箇所が無い", () => {
    const files = tsFiles(SRC);
    const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

    const names = new Set<string>();
    for (const source of sources.values()) {
      for (const match of source.matchAll(DECLARES_ASYNC_RESULT)) names.add(match[1]);
    }
    // 実測に近い下限。緩いままだと、書き方が変わって半分しか拾えなくなっても気づけない
    expect(
      names.size,
      `AsyncResult を返す関数を ${names.size} 件しか拾えていない。名前の集め方が壊れている`,
    ).toBeGreaterThanOrEqual(20);

    const pattern = bareCallOf(names);
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      const name = relative(REPO_ROOT, file);
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
