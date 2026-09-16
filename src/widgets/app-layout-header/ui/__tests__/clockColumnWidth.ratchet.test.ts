import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC } from "@/__tests__/walk";
import { formatClock } from "@/entities/game-session";

/**
 * 時計の欄が、出しうるいちばん長い綴りを吸収できることを見る。
 *
 * **桁で幅が動くと、その右にあるものがまとめて横へ動く。** ヘッダの対局の行は
 * 時計・秒読み・区切り・もう一方の席・「別の棋譜」の印が1本の flex に並ぶので、
 * 時計の箱が縮んだ瞬間に残り全部がずれる。それを止めるために `min-width` を
 * 置いてあるが、**置いた幅が上限を覆っているかは誰も見ていない** ——
 * `formatClock` は1時間を境に `M:SS` から `H:MM:SS` へ桁を1つ増やし、
 * 持ち時間の上限（`MAX_TIME_MS` = 24時間）では `24:00:00` の8文字になる。
 *
 * 3つの出典が別々に動く。SCSS の `min-width`、`formatClock` の綴り方、
 * `MAX_TIME_MS` の値。**どれを動かしてもコンパイラは緑**で、症状は
 * 「長い持ち時間の対局でだけヘッダが横に揺れる」という、当たらないと出ない形。
 *
 * 上限そのものが Rust と一致しているかは `timeLimitCap.test.ts` が見る。
 */

// **`src/__tests__` には置けない。** あちらはアプリのコードを import しない場所で、
// `formatClock` を写すと「いちばん長い綴り」の出典が2つになる
const SCSS_SITE = join(SRC, "widgets", "app-layout-header", "ui", "AppLayoutHeader.scss");
const CAP_SITE = join(SRC, "features", "start-game", "lib", "timeLimit.ts");

/** `&__game-clock` の `min-width: Nch` の N */
function clockColumnCh(): number {
  const source = readFileSync(SCSS_SITE, "utf8");
  const block = source.match(/&__game-clock\s*\{([^}]*)\}/);
  expect(block, `${SCSS_SITE} に &__game-clock の宣言が見つからない`).not.toBeNull();

  const width = block![1].match(/min-width:\s*([\d.]+)ch\s*;/);
  expect(
    width,
    "時計の欄に `min-width: Nch` が無い。幅を中身に任せると、桁を跨いだ瞬間に右の並びが動く",
  ).not.toBeNull();

  return Number(width![1]);
}

/** `MAX_TIME_MS` の右辺を評価した値。式のまま比べない（`timeLimitCap.test.ts` と同じ理由） */
function capMs(): number {
  const source = readFileSync(CAP_SITE, "utf8");
  const hit = source.match(/MAX_TIME_MS[^=]*=\s*([^;]+);/);
  expect(hit, `${CAP_SITE} に MAX_TIME_MS の定義が見つからない`).not.toBeNull();

  const expression = hit![1].replace(/_/g, "").trim();
  expect(expression, "MAX_TIME_MS が数式ではない").toMatch(/^[\d\s*+]+$/);

  return expression
    .split("*")
    .map((term) => Number(term.trim()))
    .reduce((product, term) => product * term, 1);
}

describe("時計の欄の幅", () => {
  it("上限の持ち時間を桁落ちなく置ける", () => {
    const columns = clockColumnCh();
    const cap = capMs();

    // **「0 と 0 が一致した」を緑にしない**（読めていないだけの回）
    expect(cap, "上限を読めていない").toBeGreaterThan(0);
    expect(columns, "欄の幅を読めていない").toBeGreaterThan(0);

    const longest = formatClock(cap);
    expect(
      columns,
      `上限の持ち時間は "${longest}"（${longest.length}文字）だが、欄は ${columns}ch しかない。` +
        "桁を跨いだ瞬間に、時計の右にある秒読み・区切り・もう一方の席がまとめて横へ動く",
    ).toBeGreaterThanOrEqual(longest.length);
  });

  /** 1時間を境に桁が増えること。**増えないなら上の検査は何も守っていない** */
  it("上限の綴りが、短い持ち時間より長い", () => {
    expect(formatClock(capMs()).length).toBeGreaterThan(formatClock(59_000).length);
  });
});
