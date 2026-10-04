import type { UsiOptionDef } from "@/entities/engine";
import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import type { EnginePreset } from "@/entities/engine-presets/model/types";
import { MULTIPV_OPTION } from "@/entities/engine-presets/model/multiPv";

/**
 * 「解析」の節に置く名前（`AnalysisSection` が欄を持つ）。エンジンのオプションとして送るが、利用者から
 * 見ると解析の結果の出し方（候補手を何本出すか）なので、エンジンの設定の行には出さない
 */
const ANALYSIS_OPTION_NAMES: ReadonlySet<string> = new Set([MULTIPV_OPTION]);

/** エンジンの設定の行の先頭に置く名前（よく変える） */
const PINNED_OPTION_NAMES: readonly string[] = ["Threads", "USI_Hash"];

/** 値を持てる定義（`button` は値を持たないので欄を作らない） */
export type ValueDef = Exclude<UsiOptionDef, { type: "button" }>;

export type OptionRow = {
  def: ValueDef;
  /** 画面の名前（日本語）。辞書に無ければ `null` で、エンジンの綴りを出す */
  label: string | null;
  /** 保存する値。無ければ初期値（送らない） */
  value: string | null;
  /** 初期値（表示用）。申告に既定値が無ければ `null` */
  defaultText: string | null;
  /** 値があり、初期値と違う */
  changed: boolean;
};

type OptionRowFilter = {
  /** 画面の名前・エンジンの綴りの部分一致（大小を無視） */
  query?: string;
  /** 初期値と違う値だけ */
  changedOnly?: boolean;
  /** 定跡を使うか。使わないなら定跡の設定（`group: "book"`）を出さない */
  bookUsed: boolean;
};

/**
 * 「エンジンの設定」の行。いまのエンジンの定義（`hasCurrentDefinitions`）があるときだけ。
 *
 * - 先頭に `PINNED_OPTION_NAMES`（よく変えるもの）、続けて申告の順
 * - **出さないもの**: 値を持たない `button`、アプリが決める名前（`reservedNames`。評価関数・定跡の欄と解析の
 *   固定値で決まるので、利用者が変えても送らない）、「解析」に置く名前（`ANALYSIS_OPTION_NAMES`）、
 *   定跡を使わないときの定跡の設定
 * - 同じ名前を2回申告するエンジンでも行は1つ（最初の申告）——どちらの行も同じ値を書く
 */
export function optionRows(
  draft: Pick<
    EnginePreset,
    "enginePath" | "definitions" | "definitionsFor" | "reservedNames" | "options"
  >,
  filter: OptionRowFilter,
): OptionRow[] {
  if (!hasCurrentDefinitions(draft)) return [];
  const reserved = new Set(draft.reservedNames ?? []);
  const q = (filter.query ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const rows = (draft.definitions ?? [])
    .filter((d) => !seen.has(d.name) && Boolean(seen.add(d.name)))
    .filter((d): d is ValueDef => d.type !== "button")
    .filter((d) => !reserved.has(d.name) && !ANALYSIS_OPTION_NAMES.has(d.name))
    .filter((d) => filter.bookUsed || d.group !== "book")
    .map((def): OptionRow => {
      const value = draft.options[def.name] ?? null;
      const defaultText = def.default == null ? null : String(def.default);
      return {
        def,
        label: def.label ?? null,
        value,
        defaultText,
        changed: value != null && value !== defaultText,
      };
    })
    .filter(
      (r) =>
        !q || r.def.name.toLowerCase().includes(q) || (r.label ?? "").toLowerCase().includes(q),
    )
    .filter((r) => !filter.changedOnly || r.changed);
  const pinned = PINNED_OPTION_NAMES.flatMap((name) => rows.filter((r) => r.def.name === name));
  return [...pinned, ...rows.filter((r) => !PINNED_OPTION_NAMES.includes(r.def.name))];
}
