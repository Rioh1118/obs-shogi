import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * URL を動かす呼び出しが、同じ流れの中で2回並んでいないか。
 *
 * **2本目は1本目を見ていない。** `useURLParams` の口はどれも、その描画で捕まえた
 * `searchParams` から組み直す（`navigate` は同じ tick では反映されない）。
 * 続けて呼ぶと、2本目が**1本目より前の状態**から組んで上書きする ——
 * `closeModal()` の直後に `updateParams({ dock })` を呼ぶと `modal=` が書き戻り、
 * **閉じたはずのモーダルが残ったまま**になる。
 *
 * `replace: true` だと履歴にも残らないので、戻るボタンでも気づけない。
 *
 * **直し方は1回にまとめること。** 消したい欄は `undefined` を渡せば同じ呼び出しで落ちる。
 */

/** URL を動かす口。**増えたらここへ足す**（`useURLParams` の戻り） */
const MOVERS = ["updateParams", "openModal", "closeModal", "navigateToPosition"] as const;

/** 走査が壊れて0件になったことを「違反が無い」と読ませないための下限 */
const MIN_SCANNED = 10;

/** 走査器そのもの。**自分を数えない**（綴りを本文に持っているため） */
const SELF = "src/__tests__/urlTransitionOnce.test.ts";

/**
 * **行頭から始まる呼び出しだけを見る。** 1行のコールバック
 * （`onClick={() => openModal(...)}`）は別々の操作なので、隣り合っていても
 * 同じ流れではない。ここで線を引かないと、ボタンが2つ並ぶ面が全部当たる。
 */
const CALL = new RegExp(String.raw`^[ \t]*(?:await |void )?(${MOVERS.join("|")})\s*\(`, "gm");

/** 口を定義している側。**呼び出しではない** */
const DEFINITION = "src/shared/lib/router/useURLParams.ts";

/**
 * 同じ「文の並び」の中で2回以上呼んでいる箇所。
 *
 * **関数の境目を構文で取らない。** 空行と `return` で区切られた塊を1つの流れとみなす ——
 * 続けて撃つ形は必ず隣り合う行に出るので、これで足りる。
 * 塊をまたいだ2回（別の分岐、別のコールバック）は、同じ tick に走るとは限らない。
 *
 * **`return` で切るのは、分岐ごとに1回ずつ撃つ形を数えないため**
 * （`if (…) { openModal(A); return; } if (…) { openModal(B); return; }`）。
 */
function offencesIn(file: string, body: string): string[] {
  return body
    .split(/\n\s*\n|^[ \t]*return\b[^\n]*$/m)
    .flatMap((block) => {
      const calls = [...block.matchAll(CALL)].map((found) => found[1]);
      if (calls.length < 2) return [];
      return [`${file}  ${calls.join(" → ")}`];
    })
    .slice(0, 5);
}

function scan(): { scanned: number; offences: string[] } {
  let scanned = 0;
  const offences: string[] = [];

  for (const file of tsFiles(SRC)) {
    const name = relative(REPO_ROOT, file);
    if (name === SELF || name === DEFINITION) continue;

    const body = codeOf(readFileSync(join(REPO_ROOT, name), "utf8"));
    if (!CALL.test(body)) continue;
    CALL.lastIndex = 0;

    scanned++;
    offences.push(...offencesIn(name, body));
  }

  return { scanned, offences };
}

describe("URL を動かす呼び出し", () => {
  it("走査が呼び出し元を見つけている", () => {
    // **「違反0件」と「見たセル0件」を区別する**
    expect(scan().scanned).toBeGreaterThan(MIN_SCANNED);
  });

  it("同じ流れの中で2回動かしていない", () => {
    expect(
      scan().offences,
      "URL を動かす呼び出しが同じ流れの中で2回並んでいる。" +
        "2本目はその描画で捕まえた `searchParams` から組み直すので、" +
        "**1本目より前の状態を書き戻す**。1回にまとめること" +
        "（消したい欄は `undefined` を渡せば同じ呼び出しで落ちる）",
    ).toEqual([]);
  });
});
