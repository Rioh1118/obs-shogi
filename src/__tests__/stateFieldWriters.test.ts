import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./walk";
import { TABLES_DIR, tables } from "./stateTransitionIndex";

/**
 * **「この欄を動かすのは A と B だけ」という断定が、reducer と食い違わないこと。**
 *
 * この形の腐りは3件在った。どれも綴りは実在するので、
 * `docsIdentifiers` も `ownedIdentifiers` も `docsSourcePaths` も1つも拾えない——
 * **壊れるのは綴りではなく、集合のほう。**
 *
 * 実際に起きた壊れ方:
 *
 * - `loadedAbsPath` に3つ目の書き手（`path_renamed`）が増えたのに、
 *   `persistIfPossible` の門番の理由は「`game_loaded` でしか動かない」のまま残った。
 *   その断定は「載せられなかったあと保存が全部止まる」の**根拠**だったので、
 *   読み手は保証そのものを疑うことになる
 * - `LoadedKifuPathContext` の doc は発火点を2つと言い続けた。あれは
 *   「滅多に動かないからツリーの全行に購読させてよい」の根拠
 * - `board-orientation.md` の欄の表から `reset_state` が落ち、
 *   **B0 と「閉じる」列が全部到達不能**になった
 *
 * ここが見るのは2つ。**どちらも集合の一致だけで、文章の良し悪しは見ない。**
 *
 * 1. reducer から引いた書き手の集合が、下の `WRITERS` と一致すること
 * 2. 状態遷移表の「欄の表」の行が、その欄の書き手を全部名乗っていること
 *
 * **散文の断定までは見ていない。** 「`X` は `Y` でしか動かない」を文から取り出す規則は、
 * 現物の言い回しに当ててみると誤検知だらけになった（「`loadedAbsPath` だけ」が
 * 別の意味で使われている行が複数ある）。散文は人が見る。
 */

const REDUCER = "src/entities/game/model/reducer.ts";

/**
 * **欄ごとの書き手。ここが唯一の出典。**
 *
 * 増減させたら、下の「一緒に直す場所」を1つずつ開いて言い直すこと。
 * **数を書いた文はどれも壊れる。**
 *
 * 一緒に直す場所:
 *
 * - `src/entities/game/model/types.ts` の欄の doc
 * - `src/entities/game/model/reducer.ts` の `reset_state` の「持ち越す欄」
 * - `src/entities/game/model/context.ts`（`loadedAbsPath` を配る context）
 * - `src/entities/game/model/provider.tsx` の `persistIfPossible` の門番
 * - `docs/state-transitions/game.md` と `board-orientation.md`
 */
const WRITERS: Record<string, string[]> = {
  loadedAbsPath: ["game_loaded", "path_renamed", "reset_state"],
  boardSeq: ["game_loaded", "reset_state"],
  loadFailedAbsPath: ["game_loaded", "load_failed", "reset_state"],
  loadFailedSeq: ["game_loaded", "load_failed", "reset_state"],
};

/** `case "x":` から次の `case` / `default` の手前まで */
function caseBlocks(source: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const marks = [...source.matchAll(/^\s*case "([a-z_]+)":$/gm)];

  marks.forEach((mark, i) => {
    const start = mark.index + mark[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : source.indexOf("\n    default:", start);
    blocks.set(mark[1], source.slice(start, end < 0 ? source.length : end));
  });

  return blocks;
}

/**
 * その `case` がこの欄を書くか。
 *
 * **`...initialGameState` は全部の欄を書く。** 展開する枝は、書かなかった欄を
 * 初期値へ戻すという形で全部に触っている——`reset_state` が `loadedAbsPath` を
 * null へ戻すのはこの経路で、欄の名前は現れない。
 */
function writes(block: string, field: string): boolean {
  if (block.includes("...initialGameState")) return true;
  // 行頭・`{` の直後・`,` の直後のどれか。**`.` の後は読まない**——
  // `state.loadedAbsPath === ...` は読み取りで、書き手ではない
  return new RegExp(`(?:^|[{,])\\s*${field}\\s*:`, "m").test(block);
}

const reducerSource = readFileSync(join(REPO_ROOT, REDUCER), "utf8");

describe("欄を動かす action の集合", () => {
  test("reducer から引いた集合が、控えと一致する", () => {
    const blocks = caseBlocks(reducerSource);
    expect(blocks.size, `${REDUCER} の case を読めていない`).toBeGreaterThan(5);

    const derived = Object.fromEntries(
      Object.keys(WRITERS).map((field) => [
        field,
        [...blocks].filter(([, block]) => writes(block, field)).map(([name]) => name),
      ]),
    );

    expect(
      derived,
      [
        "欄を動かす action が変わっている。",
        "**綴りを合わせるだけで閉じないこと**——この集合を根拠にした断定が",
        "コードと表に散っている。WRITERS の doc に一緒に直す場所を並べてある。",
      ].join("\n"),
    ).toEqual(
      Object.fromEntries(Object.entries(WRITERS).map(([field, names]) => [field, [...names]])),
    );
  });

  /**
   * 状態遷移表の「欄の表」は `| \`state.X\` | 持ち主 | 意味 | 動く条件 |` の形。
   * **動く条件の欄は、書き手を全部名乗っていること。**
   *
   * 落とすと表が到達不能なセルを持つ——`reset_state` が落ちた回は、
   * `loadedAbsPath` が一度非 null になったら二度と null に戻らないことになり、
   * 「盤に何も無い」状態と「閉じる」列が丸ごと宙に浮いた。
   */
  test("状態遷移表の欄の表が、書き手を全部名乗っている", () => {
    const rows: string[] = [];
    const missing: string[] = [];

    for (const file of tables()) {
      const lines = readFileSync(join(TABLES_DIR, file), "utf8").split("\n");

      for (const [field, writers] of Object.entries(WRITERS)) {
        for (const line of lines) {
          if (!line.startsWith("|")) continue;
          const first = line.split("|")[1]?.trim();
          if (first !== `\`state.${field}\``) continue;

          rows.push(`${file}  ${field}`);
          const absent = writers.filter((w) => !line.includes(w));
          if (absent.length > 0) missing.push(`${file}  ${field} → ${absent.join(" / ")}`);
        }
      }
    }

    expect(rows.length, "欄の表を1行も読めていない。表の書き方が変わった").toBeGreaterThan(0);
    expect(missing, "欄の表が書き手を名乗り落としている").toEqual([]);
  });
});
