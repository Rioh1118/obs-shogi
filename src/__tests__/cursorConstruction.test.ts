import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * `KifuCursor` を組む道具を、それを持つ2ファイルの中に閉じる。
 *
 * `makeKifuCursor(tesuu, forkPointers, tesuuPointer: string)` は第3引数に**素の string** を
 * 取り、中で brand を付けるだけで再生器を通したかを見ない。外から呼べると
 * `makeKifuCursor(te, fps, cursorKey({ tesuu: te, forkPointers: fps }))` が自然な帰結になり、
 * **要求の鍵が `state.cursor.tesuuPointer`（観測の欄）に入る**。入ると
 * `provider.tsx` の移動前後の比較が着けもしない局面の識別子で回り、
 * **盤が動かないのにエラーも出ない**。
 *
 * doc で禁じるだけでは保てなかった（同じ取り違えが2回起きている）ので口の側を閉じる。
 * `as TesuuPointer` も同じ理由で `model/cursor.ts` の中だけ。
 */
const GUARDED = /\bmakeKifuCursor\s*\(|as TesuuPointer/;

/** 道具を持つ側。`cursorFromPlayer` が唯一の本番の呼び出し口 */
const OWNERS = ["src/entities/kifu/model/cursor.ts", "src/entities/kifu/lib/playerCursor.ts"];

/**
 * テストの fixture は `cursorKey` で埋めてよい（本番の停止判定に当たる読み手が
 * テストの中に居ないため）。`__tests__` は `tsFiles` の時点で外している。
 */
const codeOf = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("KifuCursor を組む道具", () => {
  const offenders = tsFiles(SRC, { includeTests: false })
    .map((path) => ({ path, rel: relative(REPO_ROOT, path) }))
    .filter(({ rel }) => !OWNERS.includes(rel))
    .filter(({ path }) => GUARDED.test(codeOf(readFileSync(path, "utf8"))))
    .map(({ rel }) => rel)
    .sort();

  // 0件を見て緑になる形を止める
  test("持つ側では実際に使っている", () => {
    const used = OWNERS.filter((rel) =>
      GUARDED.test(codeOf(readFileSync(join(REPO_ROOT, rel), "utf8"))),
    );

    expect(used).toEqual(OWNERS);
  });

  test("外から使っていない", () => {
    expect(offenders).toEqual([]);
  });
});
