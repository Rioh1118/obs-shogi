import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rustFile, SRC } from "./walk";

/**
 * `game-event` の綴りが Rust と TS で一致していることを見る。
 *
 * **一致していないと、対局は何も届かないまま進む。** Rust は `emit` に成功し
 * （購読者がゼロでも `Ok` を返す）、フロントは張った購読に何も来ない。
 * 症状は「`startGame` は `Ok` を返すのに盤が初期局面のまま何も起きない」で、
 * これは `startGame` の TSDoc が**購読を張り忘れたときの症状**として
 * 書いているものと同じ形——踏んだ人は購読の順番を疑い続けることになる。
 *
 * 片方を改名しても `cargo test` も `npm run verify` も緑で通る。
 * どちらのコンパイラも相手を知らない。
 *
 * 両方をデータとして読む。`src/__tests__` はレイヤに依存しない
 * （`testsLayerBoundary.test.ts`）ので import では読めない。
 */

const RUST_SITE = rustFile("engine", "commands", "game.rs");
const TS_SITE = join(SRC, "entities", "game-session", "api", "events.ts");

/** `const GAME_EVENT: &str = "…";` / `export const GAME_EVENT = "…";` の中身 */
function channelIn(path: string): string {
  const source = readFileSync(path, "utf8");
  const hit = source.match(/GAME_EVENT[^=]*=\s*"([^"]+)"/);

  expect(hit, `${path} に GAME_EVENT の定義が見つからない`).not.toBeNull();
  return hit![1];
}

describe("game-event のチャンネル名", () => {
  it("Rust と TS で同じ綴りを使っている", () => {
    const rust = channelIn(RUST_SITE);
    const ts = channelIn(TS_SITE);

    expect(rust, "Rust 側の綴りを読めていない").not.toBe("");
    expect(ts, `綴りが食い違うと、対局は何も届かないまま進む（Rust: ${rust}）`).toBe(rust);
  });
});
