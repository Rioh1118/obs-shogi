import { MULTIPV_MAX, MULTIPV_MIN } from "@/entities/engine-presets/model/multiPv";
import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import { parseSpinValue } from "@/entities/engine-presets/lib/fitValues";
import type { EnginePreset, UsiOptionMap } from "@/entities/engine-presets/model/types";

/**
 * 重要オプションの節が欄を持つ名前。**全部の欄（`optionRows`）には出さない**——同じ値を2つの欄が
 * 違う範囲で書く形になる（MultiPV は解析ビューが出せる本数で頭打ちにするが、全部の欄は申告の上限までしか見ない）
 */
export const QUICK_OPTION_NAMES: ReadonlySet<string> = new Set(["MultiPV", "Threads", "USI_Hash"]);

/** 保存した値を整数で読む。値が無い（エンジン既定）・整数でないなら `null` */
export function savedInt(options: UsiOptionMap, name: string): number | null {
  const raw = options[name];
  const n = raw == null ? null : parseSpinValue(raw);
  return n == null ? null : Number(n);
}

/**
 * エンジンが申告した既定値（表示用の文字列）。定義が無い・別のエンジンの定義・既定値が無いなら `null`。
 * 「エンジン既定」が実際にいくつなのかを添えるために使う
 */
export function engineDefaultOf(
  preset: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor" | "reservedNames">,
  name: string,
): string | null {
  if (!hasCurrentDefinitions(preset)) return null;
  const def = preset.definitions?.find((d) => d.name === name);
  if (!def || def.type === "button" || def.default == null) return null;
  return String(def.default);
}

/** 「エンジン既定」の表示。既定値が分かれば添える */
export function engineDefaultLabel(defaultValue: string | null, unit = ""): string {
  return defaultValue == null ? "エンジン既定" : `エンジン既定（${defaultValue}${unit}）`;
}

/**
 * MultiPV の入力の上限。解析ビューが出せる本数（`MULTIPV_MAX`）と、エンジンが申告した上限の小さい方。
 * 定義が無い・別のエンジンの定義なら `MULTIPV_MAX`（送るときに Rust が申告の範囲へ丸める）
 */
export function multiPvMax(
  preset: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor" | "reservedNames">,
): number {
  if (!hasCurrentDefinitions(preset)) return MULTIPV_MAX;
  const def = preset.definitions?.find((d) => d.name === "MultiPV");
  if (def?.type !== "spin" || def.max == null) return MULTIPV_MAX;
  return Math.max(MULTIPV_MIN, Math.min(def.max, MULTIPV_MAX));
}
