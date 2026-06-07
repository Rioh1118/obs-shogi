import type { AnalysisConfig } from "@/entities/engine/api/rust-types";
import type { AnalysisDefaults } from "../model/types";

// UI form は欠損を許容するため、Rust に渡す直前のフォールバック値をここで一元化する。
// AnalysisDefaultsSection の placeholder と同期させること。
const DEFAULT_TIME_SECONDS = 30;
const DEFAULT_DEPTH_PLIES = 20;
const DEFAULT_NODES_COUNT = 100_000_000;

/**
 * preset の flat な {@link AnalysisDefaults} を Rust 側の discriminated union
 * {@link AnalysisConfig} に変換する。
 *
 * preset が無い (`null`/`undefined`) 場合は `infinite` にフォールバック。
 */
export function buildAnalysisConfig(defaults: AnalysisDefaults | null | undefined): AnalysisConfig {
  if (!defaults) return { mode: "infinite" };

  switch (defaults.mode) {
    case "infinite":
      return { mode: "infinite" };
    case "time": {
      const seconds =
        defaults.timeSeconds != null && defaults.timeSeconds > 0
          ? defaults.timeSeconds
          : DEFAULT_TIME_SECONDS;
      return { mode: "time", timeSeconds: seconds };
    }
    case "depth": {
      const plies =
        defaults.depth != null && defaults.depth > 0 ? defaults.depth : DEFAULT_DEPTH_PLIES;
      return { mode: "depth", depth: plies };
    }
    case "nodes": {
      const count =
        defaults.nodes != null && defaults.nodes > 0 ? defaults.nodes : DEFAULT_NODES_COUNT;
      return { mode: "nodes", nodes: count };
    }
    case "mate":
      return { mode: "mate" };
  }
}
