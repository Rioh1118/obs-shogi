import { storedDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import { bookInUse, type EnginePreset } from "@/entities/engine-presets/model/types";

/** 欄ごとの入力の誤り。無い欄は誤りが無い */
export type PresetFieldErrors = { label?: string; enginePath?: string };

const MAX_TIME_SECONDS = 3600;
const MAX_DEPTH = 999;
const MAX_NODES = 999_999_999;

/** 保存を止める入力の誤りを返す。評価関数は必須にしない。指定できないエンジンがある。 */
export function presetFieldErrors(
  draft: Pick<EnginePreset, "label" | "enginePath">,
): PresetFieldErrors {
  const errors: PresetFieldErrors = {};
  if (!draft.label.trim()) errors.label = "名前を入力してください";
  if (!draft.enginePath.trim()) errors.enginePath = "エンジンを選択してください";
  return errors;
}

/** 上限へ丸めた値を返す。0 以下は「止めない」なので持たない */
function stopLimit(value: number | undefined, max: number): number | undefined {
  if (value == null) return undefined;
  const limited = Math.min(value, max);
  return limited > 0 ? limited : undefined;
}

function analysisToSave(draft: EnginePreset): EnginePreset["analysis"] {
  const timeSeconds = stopLimit(draft.analysis?.timeSeconds, MAX_TIME_SECONDS);
  const depth = stopLimit(draft.analysis?.depth, MAX_DEPTH);
  const nodes = stopLimit(draft.analysis?.nodes, MAX_NODES);
  const mateSearch = draft.analysis?.mateSearch ?? false;
  return timeSeconds || depth || nodes || mateSearch
    ? { timeSeconds, depth, nodes, mateSearch }
    : undefined;
}

/** 空は入れない。無い名前はエンジン既定で、送らない */
function optionsToSave(draft: EnginePreset): EnginePreset["options"] {
  const options: EnginePreset["options"] = {};
  for (const [name, raw] of Object.entries(draft.options)) {
    const value = raw.trim();
    if (value) options[name] = value;
  }
  return options;
}

/** 下書きから、プリセットへ書く欄を作る。 */
export function presetPatchOf(draft: EnginePreset): Partial<EnginePreset> {
  // 前の版は使わない定跡のパスを残して保存している。落とせば、欄の「使わない」とファイルが揃う
  const bookEnabled = bookInUse(draft);
  return {
    label: draft.label.trim(),
    aiName: draft.aiName.trim(),
    enginePath: draft.enginePath.trim(),
    evalFilePath: draft.evalFilePath.trim(),
    bookEnabled,
    bookFilePath: bookEnabled ? (draft.bookFilePath ?? "").trim() : null,
    options: optionsToSave(draft),
    analysis: analysisToSave(draft),
    definitions: storedDefinitions(draft.definitions),
    reservedNames: draft.reservedNames ?? null,
    definitionsFor: draft.definitionsFor ?? null,
    probedAt: draft.probedAt ?? null,
    engineName: draft.engineName ?? null,
    engineAuthor: draft.engineAuthor ?? null,
  };
}
