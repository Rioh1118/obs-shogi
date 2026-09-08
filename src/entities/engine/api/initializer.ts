import { setupYaneuraOuEngine } from "../lib/setup";
import type { EngineRuntimeConfig } from "../model/types";
import type { EngineInfo } from "./rust-types";
import { shutdownEngine } from "./tauri";

/**
 * エンジンの起動と畳みを、**同時に1本**に絞る口。
 *
 * ここが約束すること（差し替える側もこの契約を満たすこと）:
 *
 * - **飛んでいる起動が在れば、`initialize` はそれを返す。** 引数は**見ない**
 *   ——別の設定で呼んでも、返るのは先に飛んでいる起動の結果。
 *   どの設定で起きたかを記録するのは呼び手の責任（`EngineProvider` の `lastTriedRef`）
 * - **`shutdown` は飛んでいる起動の決着を待ってから畳む。** 待っている間に
 *   次の起動が始まっていたら、**畳みは撃たない**——Rust の `shutdown` は
 *   そのとき載っているプロセスを落とすので、撃つと後から起きたエンジンを殺す
 * - **畳みの失敗は呼び手へ投げる。** `shutdown_engine` は `Err` を返しうるので
 *   `shutdown()` は reject する。`EngineProvider` の `restart()` はそこで切れ、
 *   起こし直すのは effect の `idle` の枝（→ `docs/state-transitions/engine.md` の ※3）
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
