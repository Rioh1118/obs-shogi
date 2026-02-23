import { DEFAULT_USI_OPTIONS } from "../model/defaultOptions";
import type {
  EnginePreset,
  PresetId,
  PresetsFile,
  UsiOptionMap,
} from "../model/types";

export function genPresetId(): PresetId {
  return crypto.randomUUID();
}

export function clonePreset<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

export function createDefaultPreset(
  partial: Partial<EnginePreset> = {},
): EnginePreset {
  const id = partial.id ?? genPresetId();
  const base: EnginePreset = {
    id,
    label: "",

    aiName: "",
    enginePath: "",
    evalFilePath: "",
    bookEnabled: false,
    bookFilePath: null,
    options: { ...DEFAULT_USI_OPTIONS },
    analysis: undefined,
  };

  const merged: EnginePreset = {
    ...base,
    ...partial,
    options: {
      ...base.options,
      ...(partial.options ?? {}),
    },
    analysis: partial.analysis ? { ...partial.analysis } : base.analysis,
  };
  if (!merged.bookEnabled) merged.bookFilePath = null;

  return merged;
}

export function normalizeOnePreset(raw: Partial<EnginePreset>): EnginePreset {
  const p = createDefaultPreset(raw);

  p.label = (p.label ?? "").trim() || "";
  p.aiName = (p.aiName ?? "").trim();
  p.enginePath = (p.enginePath ?? "").trim();
  p.evalFilePath = (p.evalFilePath ?? "").trim();

  // book
  p.bookEnabled = Boolean(p.bookEnabled);
  if (!p.bookEnabled) {
    p.bookFilePath = null;
  } else {
    const bp = (p.bookFilePath ?? "").trim();
    p.bookFilePath = bp.length > 0 ? bp : null;
  }

  const nextOptions: UsiOptionMap = {};
  for (const [k, v] of Object.entries(p.options ?? {})) {
    const vv = String(v ?? "").trim();
    if (!vv) continue;
    nextOptions[k] = vv;
  }
  p.options = { ...DEFAULT_USI_OPTIONS, ...nextOptions };

  if (p.analysis) {
    const a = { ...p.analysis };
    if (a.timeSeconds != null && a.timeSeconds <= 0) delete a.timeSeconds;
    if (a.depth != null && a.depth <= 0) delete a.depth;
    if (a.nodes != null && a.nodes <= 0) delete a.nodes;
    p.analysis = a;
  }

  return p;
}

export function normalizeLoadedFile(file: PresetsFile | null): EnginePreset[] {
  const presets = file?.presets ?? [];
  const normalized = presets.map((p) => normalizeOnePreset(p));

  // id 重複の保険（もし壊れてたら再採番）
  const seen = new Set<string>();
  for (let i = 0; i < normalized.length; i++) {
    const id = normalized[i].id;
    if (!id || seen.has(id)) normalized[i].id = genPresetId();
    seen.add(normalized[i].id);
  }

  return normalized;
}
