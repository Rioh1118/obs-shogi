import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "@/__tests__/walk";
import { codeOf } from "@/__tests__/sourceText";

/**
 * `EnginePreset` から `EngineRuntimeConfig` を組む場所が1つだけか。
 *
 * **2箇所で書くと、tsc が片方しか守らない。** 必須欄が増えたときは両方落ちるが、
 * `bookFile` の出し方を変える・欄の値の出どころを変える、といった変更は
 * **片方だけ直しても通る。** 結果は「解析では定跡を読むのに対局では読まない」で、
 * 起動して対局を1局進めるまで分からない。
 *
 * 実際に2箇所あった —— `entities/engine-presets/model/provider.tsx` の
 * `runtimeConfig` と `features/start-game/lib/playerSpec.ts` の `enginePlayer`。
 * 共有されていたのは `derivePaths`（パス導出）と `usiOptionsOf`（`setoption` の合成）
 * だけで、**プリセットのどの欄が設定のどの欄になるかは2回手書きされていた。**
 *
 * **見るのは「プリセットから組んでいる」形だけ。** 型名を名乗らないリテラルでも
 * 引っかかるように、`evalDir` と `bookFile` と `workDir` が同じ括弧の中に並び、
 * かつその中で `preset` を引いているかで見る。型注釈で見ると、`playerSpec.ts` が
 * やっていた「名乗らないリテラルを `usiOptionsOf` に直接渡す」形を1件も拾えない。
 *
 * **`preset` を引いていない組み立ては見ない。** 既にある設定を写す形
 * （`api/initializer.ts`）や、2つを比べる形（`lib/equalRuntime.ts`）は、
 * プリセットのどの欄がどこへ行くかを決めていないので、割れようが無い。
 */

/** 組み立て口の持ち主。**ここだけが並べてよい** */
const OWNER = "src/entities/engine-presets/lib/derivePath.ts";

/**
 * 設定を組んでいる形。`evalDir` と `bookFile` と `workDir` が近くに並ぶ。
 *
 * **順不同で見る。** 欄の並べ替えだけで走査を外せると、止めたい変更の多くが抜ける。
 */
const FIELDS = ["evalDir", "bookFile", "workDir"] as const;

/** 走査が壊れて0件になったことを「違反が無い」と読ませないための下限 */
const MIN_SCANNED = 100;

/**
 * 1つの括弧の中に3つとも在るか。
 *
 * **括弧の対応は取らない。** `{` から次の `}` までを1つの塊として見る雑な走査で、
 * 入れ子があると塊が短く切れる —— 見落とす側に倒れるので、
 * 「違反が無い」を偽って主張することは無い。
 */
function assemblesConfig(body: string): boolean {
  return body.split("{").some((chunk) => {
    const block = chunk.slice(0, chunk.indexOf("}"));
    return FIELDS.every((field) => block.includes(field)) && /preset/i.test(block);
  });
}

function scan(): { scanned: number; offences: string[] } {
  let scanned = 0;
  const offences: string[] = [];

  for (const file of tsFiles(SRC, { includeTests: false })) {
    const name = relative(REPO_ROOT, file);
    if (name === OWNER) continue;

    scanned++;
    if (assemblesConfig(codeOf(readFileSync(join(REPO_ROOT, name), "utf8")))) {
      offences.push(name);
    }
  }

  return { scanned, offences };
}

describe("エンジンの設定を組む口", () => {
  it("走査がソースを見つけている", () => {
    // **「違反0件」と「見たファイル0件」を区別する**
    expect(scan().scanned).toBeGreaterThan(MIN_SCANNED);
  });

  it("持ち主の外で組んでいない", () => {
    expect(
      scan().offences,
      `${OWNER} の \`runtimeConfigOf\` の外で \`EngineRuntimeConfig\` を組んでいる。` +
        "2箇所に在ると、必須欄が増える場合を除いて**tsc は片方だけ直しても通る** ——" +
        "「解析では定跡を読むのに対局では読まない」が起動するまで分からない。" +
        "`runtimeConfigOf` を呼ぶこと",
    ).toEqual([]);
  });
});
