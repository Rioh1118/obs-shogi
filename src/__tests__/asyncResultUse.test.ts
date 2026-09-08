import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * **戻り値を読まないと失敗が消える関数**を、式文で呼んでいないかを見る。
 *
 * 対象は2種類。`AsyncResult` を返すものは**投げない**ので、読まないと失敗は
 * どこにも出ないまま次の行へ進む。`SeatTakeResult` を返すものは投げるが、
 * **握れなかった理由**（エンジンが消えた／要求が死んだ）を戻り値でしか言わないので、
 * 捨てると枝ごとの後始末が黙って落ちる。
 *
 * 捨てると、別の理由の警告だけが画面に出る形になりやすい。
 * フォルダを作れなかったのに「中身が未検出です」と出れば、
 * 利用者は「まだ置いていないだけ」と読む。
 *
 * 構文解析はしない。**行頭から始まる式文の呼び出し**（`f(...)` / `await f(...)` /
 * `void f(...)`。結果を代入も分岐もしない形）だけを見る。`if (!res.success)` を
 * 書かせるところまでは見ない。
 *
 * **行頭に来ない呼び出しは見ていない**——1行のコールバック（`setTimeout(() => void f(...), 0)`）、
 * `if (ok) void f(...)`、代入。広げると `jobs.push(f())` のような正当な形が落ちるので、
 * ここで線を引いている。**その先は人が見る。**
 *
 * 読まないのが正しい呼び出しもある（呼び先が自分で `state.error` に積む場合）。
 * その1行に `// async-result-ignored: <理由>` を付けると外れる。
 * 印を付ける変更は差分としてレビューに出る。
 */

/**
 * 読まねばならない戻り値型。**増やすときは、なぜ捨てると失敗が消えるかを doc に書く。**
 */
const MUST_READ = String.raw`(?:AsyncResult<|Promise<SeatTakeResult>)`;

/**
 * 宣言の戻り値に `MUST_READ` の型が現れる関数名。
 *
 * **行をまたげること。** この repo の主流の書き方は
 * `const f = useCallback(` で改行して次の行に `: AsyncResult<...> =>` なので、
 * 1行に閉じた正規表現だと `provider.tsx` の主要な関数が丸ごと外れる。
 * `;` `{` `}` を挟まない範囲に限って、別の宣言まで飲み込まないようにする
 */
const DECLARES_MUST_READ = new RegExp(
  String.raw`(?:function\s+|const\s+)(\w+)[^;{}]*?:\s*${MUST_READ}`,
  "g",
);

/** 読まないのが正しいときの印。理由を書かせるので `:` まで含めて要求する */
const IGNORE_MARKER = "async-result-ignored:";

/**
 * 行頭から始まる呼び出し。代入も `return` も付いていない＝結果を読みようがない形。
 *
 * **`void` も `await` も任意にする。** どちらかを要求すると、その綴りを消すだけで
 * 抜けられる——**素の `f(...)` がいちばん普通の投げっぱなしの形**で、しかも順序まで
 * 失う（後ろの `finally` より先に進む）。許してよい理由が無いので同じ扱いにする。
 */
function bareCallOf(names: Set<string>): RegExp {
  const call = `(?:\\w+\\.)?(${[...names].join("|")})`;
  return new RegExp(`^[ \\t]*(?:void )?(?:await )?${call}\\([^\\n]*`, "gm");
}

describe("読まねばならない戻り値", () => {
  it("結果を読まずに呼んでいる箇所が無い", () => {
    const files = tsFiles(SRC);
    // **コメントを落としてから名前を集める。** 落とさないと、doc に書いた例文
    // （`const f = useCallback(` / `: AsyncResult<...>`）が「読まねばならない関数」に
    // 化け、`f` のような綴りで無関係な行が赤くなる。
    const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
    const code = new Map([...sources].map(([file, body]) => [file, codeOf(body)]));

    const names = new Set<string>();
    for (const source of code.values()) {
      for (const match of source.matchAll(DECLARES_MUST_READ)) names.add(match[1]);
    }
    // 実測に近い下限。緩いままだと、書き方が変わって半分しか拾えなくなっても気づけない
    expect(
      names.size,
      `戻り値を読むべき関数を ${names.size} 件しか拾えていない。名前の集め方が壊れている`,
    ).toBeGreaterThanOrEqual(20);

    // **枝ごとに1本ずつ名指す。** 集計だけだと、片方の枝を丸ごと落としても数が
    // ほとんど動かない——`AsyncResult` 側が数を支配しているので、`SeatTakeResult` の枝を
    // 消しても 32 → 31 にしかならず下限に当たらない（実測）。
    expect(names, "`AsyncResult<` の枝が `MUST_READ` から落ちている").toContain("loadFileTree");
    expect(names, "`Promise<SeatTakeResult>` の枝が `MUST_READ` から落ちている").toContain(
      "takeSeatAndGo",
    );

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
        "戻り値を読まないと失敗が消える関数を、式文で呼んでいる。",
        "失敗も、握れなかった理由も、どこにも出ないまま次の行へ進む。",
        `読まないのが正しいなら、その行に // ${IGNORE_MARKER} <理由> を付けること。`,
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
