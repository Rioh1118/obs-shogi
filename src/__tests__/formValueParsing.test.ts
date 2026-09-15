import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * 入力欄の値を、その場で数へ直していないか。
 *
 * **`Number(欄の値)` は失敗を返さない。** 打った文字が数でなければ `NaN` になり、
 * `Math.max(0, …)` も `Math.trunc(…)` も `NaN` を吸わずに通す。
 * そのまま境界へ出ると `JSON.stringify` が `null` に変えるので、
 * Rust 側の `u64` は**取り込みの時点で**落ちる ——
 * 画面に出るのは利用者の言葉でない serde の英文で、どの欄が悪いかは分からない。
 *
 * 全角で打てば必ず踏む（`Number("１０")` は `NaN`）。IME を閉じ忘れただけで起きる。
 *
 * **数で持つと欄も壊れる。** `Number("")` の `0` が居座って空にできず、
 * `NaN` は `"NaN"` と表示されて1文字ずつ消しても戻らない。
 *
 * だから**欄は打った文字列のまま持ち、数に直すのは送る直前の1箇所だけ**にする
 * （`features/start-game/lib/timeLimit.ts` の `msOf`）。
 */

/** 走査が壊れて0件になったことを「違反が無い」と読ませないための下限 */
const MIN_SCANNED = 15;

/**
 * その場で数へ直している形。`Number(e.target.value)` / `parseInt(event.target.value)` ほか。
 *
 * **`valueAsNumber` も同じ。** `type="number"` の欄でも、空なら `NaN` が返る。
 */
const PARSED_IN_PLACE =
  /\b(?:Number|parseInt|parseFloat)\s*\(\s*\w+\.(?:target|currentTarget)\.value\b|\.(?:target|currentTarget)\.valueAsNumber\b/g;

/** 欄を触っているファイルを数える。走査の対象がまだ在ることの下限に使う */
const TOUCHES_INPUT = /\.(?:target|currentTarget)\.value\b/;

function scan(): { scanned: number; offences: string[] } {
  let scanned = 0;
  const offences: string[] = [];

  for (const file of tsFiles(SRC)) {
    const name = relative(REPO_ROOT, file);
    if (name === SELF) continue;

    const body = codeOf(readFileSync(join(REPO_ROOT, name), "utf8"));
    if (TOUCHES_INPUT.test(body)) scanned++;

    for (const found of body.matchAll(PARSED_IN_PLACE)) {
      offences.push(`${name}  ${found[0]}`);
    }
  }

  return { scanned, offences };
}

/** 走査器そのもの。**自分を数えない**（綴りを本文に持っているため） */
const SELF = "src/__tests__/formValueParsing.test.ts";

describe("入力欄の値", () => {
  it("走査が欄を触っているファイルを見つけている", () => {
    // **「違反0件」と「見たセル0件」を区別する**
    expect(scan().scanned).toBeGreaterThan(MIN_SCANNED);
  });

  it("欄の値をその場で数へ直していない", () => {
    expect(
      scan().offences,
      "入力欄の値をその場で数へ直している。数でない入力は `NaN` になり、" +
        "`Math.max` も `Math.trunc` も吸わずに境界まで通る（`JSON` は `null` に変える）。" +
        "**欄は文字列のまま持ち、数に直すのは送る直前の1箇所だけ**にすること",
    ).toEqual([]);
  });
});
