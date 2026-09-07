import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { hitsIn } from "./sourceText";

/**
 * 解析の席の識別子（`AnalysisSessionId`）を鋳造する綴りを、IPC の境界に閉じる。
 *
 * brand は素の `string` からの代入を tsc が止めるが、`as` は素通りする。
 * **取り違える相手がすぐ隣に居る**——`AnalysisProvider` は席の識別子と SFEN を
 * 同じスコープに持ち、どちらも `string`。取り違えた回は本物の `info` が全部落ち
 * （席の照合に通らない）、停止は `Err` になり、**本物の席が Rust に残ったまま
 * エンジンを起こし直すまで戻らない**（#441 の症状そのもの）。
 *
 * **鋳造してよいのは Rust から受け取る行だけ。** `api/events` は `listen` の
 * 型引数で受けるので `as` を書かない——だから持ち主は1つ。
 *
 * テストは走査から外してある（`includeTests: false`）。テストが自分で識別子を
 * 作るのは、Rust の役をテストが演じているぶんなので止めない。
 */
const RULE = {
  name: "AnalysisSessionId への as キャスト",
  /** 二重キャストは brand を素通りする */
  pattern: /as (?:unknown as )?AnalysisSessionId\b/,
  owners: ["src/entities/engine/api/tauri.ts"],
} as const;

const owners: string[] = [...RULE.owners];
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

describe(RULE.name, () => {
  test("持ち主の外では書いていない", () => {
    const offenders = tsFiles(SRC, { includeTests: false })
      .map((path) => relative(REPO_ROOT, path))
      .filter((rel) => !owners.includes(rel))
      .flatMap((rel) => hitsIn(rel, read(rel), RULE.pattern))
      .sort();

    expect(offenders).toEqual([]);
  });

  // 対象が0件になって「何も見ていないのに緑」になる形を止める
  test.each(owners)("%s では実際に書いている", (rel) => {
    expect(
      hitsIn(rel, read(rel), RULE.pattern).length > 0,
      `${rel} からこの綴りが消えたなら、owners から外して番人を減らすこと`,
    ).toBe(true);
  });
});
