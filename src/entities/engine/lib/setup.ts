import type { SetOptionValue } from "../api/rust-types";
import type { EngineRuntimeConfig } from "../model/types";

/**
 * 利用者の値を送る形にする。**USI の名前を足さない**——評価関数・定跡・固定値の名前は Rust が
 * 起動のたびの申告から決める（`binding.rs`）。送る順も Rust が決める（申告の順）
 */
export function valuesOf(config: EngineRuntimeConfig): SetOptionValue[] {
  return Object.entries(config.values).map(([name, value]) => ({ name, value }));
}
