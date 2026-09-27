import { MULTIPV_MAX, MULTIPV_MIN } from "@/entities/engine-presets/model/multiPv";
import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import { parseSpinValue } from "@/entities/engine-presets/lib/fitValues";
import type { EnginePreset, UsiOptionMap } from "@/entities/engine-presets/model/types";

/** 保存した値を整数で読む。値が無い（エンジン既定）・整数でないなら `null` */
export function savedInt(options: UsiOptionMap, name: string): number | null {
  const raw = options[name];
  const n = raw == null ? null : parseSpinValue(raw);
  return n == null ? null : Number(n);
}

/**
 * MultiPV の入力の上限。解析ビューが出せる本数（`MULTIPV_MAX`）と、エンジンが申告した上限の小さい方。
 * 定義が無い・別のエンジンの定義なら `MULTIPV_MAX`（送るときに Rust が申告の範囲へ丸める）
 */
export function multiPvMax(
  preset: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor">,
): number {
  if (!hasCurrentDefinitions(preset)) return MULTIPV_MAX;
  const def = preset.definitions?.find((d) => d.name === "MultiPV");
  if (def?.type !== "spin" || def.max == null) return MULTIPV_MAX;
  return Math.max(MULTIPV_MIN, Math.min(def.max, MULTIPV_MAX));
}
