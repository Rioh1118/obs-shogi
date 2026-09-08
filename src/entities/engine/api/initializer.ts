import { setupYaneuraOuEngine } from "../lib/setup";
import type { EngineRuntimeConfig } from "../model/types";
import type { EngineInfo } from "./rust-types";
import { shutdownEngine } from "./tauri";

/**
 * エンジンの起動と畳みを、**同時に1本**に絞る口。
 *
 * **本物が守ること**（差し替えるなら、どの条を落としたかを double の doc に書くこと
 * ——`model/__tests__/provider.test.tsx` の double は第1条も第2条も満たさない）:
 *
 * - **飛んでいる起動が在れば、`initialize` はそれを返す。** 引数は**見ない**
 *   ——別の設定で呼んでも、返るのは先に飛んでいる起動の結果。**この枝は1つの
 *   provider の中では踏めない**（`EngineProvider` が起動の門で塞いでいる）。
 *   踏めるのは provider ごと張り直した回だけで、そのとき呼び手は新しい設定を
 *   `activeRuntime` に誤って書く（→ `docs/state-transitions/engine.md` の ※2 / 不変条件1）
 * - **自分が掴んだ起動の決着は待ってから畳む。** 待っている間に次の起動が始まっていたら
 *   **畳みは撃たない**——Rust の `shutdown` はそのとき載っているプロセスを落とすので、
 *   撃つと後から起きたエンジンを殺す。**掴んでいる起動が無い回は待たない**
 *   （先行する畳みが既に `inFlight` を空けている）ので、起動が実際に飛んでいても IPC は撃つ
 * - **畳みの失敗は呼び手へ投げる。** `shutdownEngine()` は裸の `await` なので、
 *   invoke が落ちれば通る（**Rust 側が `Err` を返す筋はいま無い**
 *   → `docs/state-transitions/engine.md` の「埋まっていないセル」）。
 *   `EngineProvider` の `restart()` はそこで切れ、起こし直すのは effect の `idle` の枝（→ ※3）
 */
export interface EngineInitializer {
  initialize(runtime: EngineRuntimeConfig): Promise<EngineInfo>;
  shutdown(): Promise<void>;
}

class YaneuraOuInitializer implements EngineInitializer {
  private inFlight: Promise<EngineInfo> | null = null;
  private seq = 0;

  async initialize(runtime: EngineRuntimeConfig): Promise<EngineInfo> {
    if (this.inFlight) return this.inFlight;

    this.seq++;
    const p = setupYaneuraOuEngine({
      enginePath: runtime.enginePath,
      workDir: runtime.workDir,
      evalDir: runtime.evalDir,
      bookDir: runtime.bookDir,
      bookFile: runtime.bookFile,
      options: runtime.options,
    }).finally(() => {
      // **自分が居座っているときだけ空ける。** 畳みが先に空けて次が入った後だと、
      // 無条件に空けると新しい起動の in-flight を消して3本目が撃てるようになる。
      if (this.inFlight === p) this.inFlight = null;
    });
    this.inFlight = p;

    return p;
  }

  async shutdown(): Promise<void> {
    const mySeq = ++this.seq;
    const p = this.inFlight;
    this.inFlight = null;

    if (p) {
      try {
        await p;
      } catch {
        /* ignore */
      }
    }

    // **待っている間に次が始まっていたら撃たない。** Rust の `shutdown` は
    // `engine_id` を無条件に take するので、撃つ相手は**そのとき載っているプロセス**
    // ——待たされた1本が目を覚ますと、後から起きた健全なエンジンを殺す。
    // 古いプロセスは次の `initialize_engine` が先頭で畳むので、撃たなくても残らない。
    if (this.seq !== mySeq) return;

    await shutdownEngine();
  }
}

export const engineInitializer = new YaneuraOuInitializer();
