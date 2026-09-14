import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * `vi.mock` の差し替えが、差し替える先の形と結び付いているか。
 *
 * **`vi.mock` の第2引数は `unknown` 扱いなので tsc が素通しする。**
 * 実モジュールが export を1つ増やしても、名前を変えても、引数の数を変えても、
 * ファクトリは古い形のまま緑で残る。**テストが見ているのは自分が書いた偽物だけ**になり、
 * 境界の食い違いを見つける役に立たなくなる。
 *
 * `satisfies typeof import("…")` を書かせると、**export の増減と改名**は tsc が落とす
 * （`vi.fn()` が `any` を返すぶん、引数と戻り値までは捕まらない）。
 *
 * **`-D` では入れない。** 印の無い `vi.mock` は入れた時点で {@link BASELINE} 件あり、
 * 全部に印を付けるのは別の作業。増える方向にだけ落とす件数ラチェットにして、
 * **今日から新しい差し替えに掛ける**。片付けたら基準を下げること。
 *
 * 出典は `.claude/knowledge/mechanization-backlog.md`（2件目で入れた）。
 */

/**
 * 印の無い `vi.mock(…, ファクトリ)` の件数。
 *
 * **動かしてよい向きは下げる方だけ。** 増えて落ちたときは、基準ではなく
 * 足した `vi.mock` の側に `satisfies typeof import("…")` を書く。
 */
const BASELINE = 180;

/** 走査が壊れて0件になったことを「違反が無い」と読ませないための下限 */
const MIN_SCANNED = 150;

/** 印。`satisfies typeof import("…")` をファクトリの中のどこかに持つこと */
const MARKER = "satisfies typeof import(";

interface MockCall {
  file: string;
  /** `vi.mock(` の開き括弧から閉じ括弧までの本文 */
  text: string;
}

/**
 * `vi.mock(` の呼び出しを、括弧の対応を数えて切り出す。
 *
 * **正規表現で終端を探さない。** ファクトリの中に `)` はいくらでも出るので、
 * 非貪欲で切ると最初の `)` で止まり、**印を書いてあっても見つけられない**。
 */
function mockCallsIn(file: string, body: string): MockCall[] {
  const calls: MockCall[] = [];
  const needle = "vi.mock(";

  for (let at = body.indexOf(needle); at >= 0; at = body.indexOf(needle, at + 1)) {
    let depth = 0;
    let end = -1;
    for (let i = at + needle.length - 1; i < body.length; i++) {
      const ch = body[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    calls.push({ file, text: body.slice(at, end + 1) });
  }

  return calls;
}

/** ファクトリを渡している呼び出しだけ。`vi.mock("…")` の1引数の形は対象外 */
function hasFactory(text: string): boolean {
  return /,\s*(?:async\s+)?\(\s*\)\s*=>/.test(text) || /,\s*(?:async\s+)?function\b/.test(text);
}

/**
 * 走査器そのもの。**自分を数えない** —— このファイルは綴りを本文に持っているので、
 * 数えると基準が1件ぶん嵩上げされ、その1件は永久に印が付かない
 */
const SELF = "src/__tests__/viMockShape.test.ts";

function scan(): { total: number; unmarked: string[] } {
  const calls = tsFiles(SRC)
    .map((file) => relative(REPO_ROOT, file))
    .filter((file) => file !== SELF)
    .flatMap((file) => mockCallsIn(file, codeOf(readFileSync(join(REPO_ROOT, file), "utf8"))))
    .filter((call) => hasFactory(call.text));

  return {
    total: calls.length,
    unmarked: calls.filter((call) => !call.text.includes(MARKER)).map((call) => call.file),
  };
}

describe("`vi.mock` の差し替え", () => {
  it("走査が対象を見つけている", () => {
    // **「違反0件」と「見たセル0件」を区別する。** 切り出しが壊れて0を返しても
    // 下の検査は緑になる
    expect(scan().total).toBeGreaterThan(MIN_SCANNED);
  });

  it("印の無い差し替えが増えていない", () => {
    const { unmarked } = scan();

    expect(
      unmarked.length,
      `\`vi.mock\` のファクトリに \`${MARKER}…")\` が無いものが ${unmarked.length} 件ある` +
        `（基準 ${BASELINE}）。差し替える先の形と結び付いていないので、` +
        `export を増やしても改名しても tsc は落ちない。\n` +
        `増えたなら、足した側に印を書くこと。減ったなら BASELINE を下げること。\n` +
        `直近: ${[...new Set(unmarked)].slice(0, 5).join(", ")}`,
    ).toBe(BASELINE);
  });
});
