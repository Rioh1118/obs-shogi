import { startEngine } from "../lib/setup";
import type { EngineRuntimeConfig } from "../model/types";
import type { EngineInfo } from "./rust-types";
import { shutdownEngine } from "./tauri";

/**
 * 解析用エンジンの起動と停止。
 *
 * **重なった呼び出しをここで束ねない。** 起動中に次の起動や停止が来たときの始末は
 * Rust が持つ（`EngineAnalyzer::start_engine`: 前の起動を落とし、前の呼び出しは
 * `cancelled` で断られる）。ここで進行中の起動を使い回すと、別の設定の起動結果を
 * 新しい設定のものとして受け取る。停止も進行中の起動を待たない——待つと、
 * `readyok` を返さないエンジンで停止ごと固まる。
 */
export interface EngineInitializer {
  initialize(runtime: EngineRuntimeConfig): Promise<EngineInfo>;
  shutdown(): Promise<void>;
}

export const engineInitializer: EngineInitializer = {
  initialize: (runtime) => startEngine(runtime),
  shutdown: () => shutdownEngine(),
};
