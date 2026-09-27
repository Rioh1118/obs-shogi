import type { UsiOptionDef } from "@/entities/engine";
import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

/** 値を持てる定義（`button` は値を持たないので欄を作らない） */
export type ValueDef = Exclude<UsiOptionDef, { type: "button" }>;

export type OptionRow = {
  def: ValueDef;
  /** 保存する値。無ければエンジン既定 */
  value: string | null;
  /** 既定値（表示用）。申告に既定値が無ければ `null` */
  defaultText: string | null;
  /** アプリが決める名前（評価関数・定跡の欄と解析の固定値）。欄は読み取り専用 */
  reserved: boolean;
  /** 値があり、既定値と違う（目立たせる） */
  changed: boolean;
};

/**
 * 全部のオプションの欄。いまのエンジンの定義（`hasCurrentDefinitions`）があるときだけ、**申告の順**で。
 * `query` は名前の部分一致（大小を無視）
 */
export function optionRows(
  draft: Pick<
    EnginePreset,
    "enginePath" | "definitions" | "definitionsFor" | "reservedNames" | "options"
  >,
  query = "",
): OptionRow[] {
  if (!hasCurrentDefinitions(draft)) return [];
  const reserved = new Set(draft.reservedNames ?? []);
  const q = query.trim().toLowerCase();
  return (draft.definitions ?? [])
    .filter((d): d is ValueDef => d.type !== "button")
    .filter((d) => !q || d.name.toLowerCase().includes(q))
    .map((def) => {
      const value = draft.options[def.name] ?? null;
      const defaultText = def.default == null ? null : String(def.default);
      return {
        def,
        value,
        defaultText,
        reserved: reserved.has(def.name),
        changed: value != null && value !== defaultText,
      };
    });
}

/**
 * 保存済みの値のうち、いまのエンジンの定義に無い名前。定義が無い・別のエンジンの定義なら、
 * `exclude`（別の欄を持つ名前）以外の全部
 */
export function valuesWithoutField(
  draft: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor" | "options">,
  exclude: ReadonlySet<string>,
): Array<[string, string]> {
  const declared = hasCurrentDefinitions(draft)
    ? new Set((draft.definitions ?? []).map((d) => d.name))
    : null;
  return Object.entries(draft.options).filter(
    ([name]) => !exclude.has(name) && !(declared?.has(name) ?? false),
  );
}
