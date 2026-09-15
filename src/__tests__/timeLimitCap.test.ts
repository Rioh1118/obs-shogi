import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rustFile, SRC } from "./walk";

/**
 * 持ち時間の上限が Rust と TS で一致していることを見る。
 *
 * **写しを置いているのは、押す前に止めるため。** 上限を知らない画面は、
 * 超えた値でも「押せる」を出したまま**棋譜のファイルを作ってから** `start_game` を呼ぶ。
 * `TimeLimit::validate` が断るので対局は始まらず、**使われない棋譜が1枚残る**。
 * 出るのは Rust の英文（`main time must not exceed …`）で、どの欄が悪いかは読めない。
 *
 * **片方を動かしても両方のコンパイラが緑で通る。** どちらも相手を知らない。
 * Rust 側の doc は「足りなくなったら上げてよい」と言っているので、上がる日は来る。
 * 上げた回にこちらが取り残されると、**通る値を画面が断り続ける** ——
 * 症状は「設定できない」で、原因の側（Rust）を見ても何も間違っていない。
 *
 * 両方をデータとして読む。`src/__tests__` はレイヤに依存しない
 * （`testsLayerBoundary.test.ts`）ので import では読めない。
 */

const RUST_SITE = rustFile("engine", "game", "types.rs");
const TS_SITE = join(SRC, "features", "start-game", "lib", "timeLimit.ts");

/**
 * `MAX_TIME_MS` の右辺を評価した値。
 *
 * **式のまま比べない。** 綴りは `24 * 60 * 60 * 1000` と `86_400_000` のどちらでも
 * 書けるうえ、Rust には型注釈（`: u64`）が挟まる。値で比べる。
 */
function capIn(path: string): number {
  const source = readFileSync(path, "utf8");
  const hit = source.match(/MAX_TIME_MS[^=]*=\s*([^;]+);/);

  expect(hit, `${path} に MAX_TIME_MS の定義が見つからない`).not.toBeNull();

  // 数と演算子だけを残す。`_` の桁区切りは両言語にあるので落とす
  const expression = hit![1].replace(/_/g, "").trim();
  expect(expression, `${path} の MAX_TIME_MS が数式ではない`).toMatch(/^[\d\s*+]+$/);

  return expression
    .split("*")
    .map((term) => Number(term.trim()))
    .reduce((product, term) => product * term, 1);
}

describe("持ち時間の上限", () => {
  it("Rust と TS で同じ値を使っている", () => {
    const rust = capIn(RUST_SITE);
    const ts = capIn(TS_SITE);

    // **「0 と 0 が一致した」を緑にしない**（読めていないだけの回）
    expect(rust, "Rust 側の値を読めていない").toBeGreaterThan(0);
    expect(
      ts,
      `上限が食い違うと、画面が通る値を断るか、断られる値で棋譜を作る（Rust: ${rust}）`,
    ).toBe(rust);
  });
});
