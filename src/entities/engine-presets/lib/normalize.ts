import type { EnginePreset, PresetId, UsiOptionMap } from "../model/types";

export function genPresetId(): PresetId {
  return crypto.randomUUID();
}

export function clonePreset<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

/**
 * 新しく作るプリセットだけが持つ値。**他の名前はエンジン既定**（値を持たず、送らない）。
 *
 * MultiPV だけを入れるのは、解析ビューが候補手を並べる画面だから——やねうら王の既定は 1 で、
 * 何も入れないと候補が1本しか出ない。**読み込んだプリセットには足さない**（`normalizeOnePreset`）
 */
const NEW_PRESET_OPTIONS: UsiOptionMap = { MultiPV: "5" };

/** 新しいプリセットを作る（`NEW_PRESET_OPTIONS` を持つ） */
export function createDefaultPreset(partial: Partial<EnginePreset> = {}): EnginePreset {
  return withDefaults(partial, NEW_PRESET_OPTIONS);
}

function withDefaults(partial: Partial<EnginePreset>, options: UsiOptionMap): EnginePreset {
  const id = partial.id ?? genPresetId();
  const base: EnginePreset = {
    id,
    label: "",

    aiName: "",
    enginePath: "",
    evalFilePath: "",
    bookEnabled: false,
    bookFilePath: null,
    options: { ...options },
    analysis: undefined,
  };

  const merged: EnginePreset = {
    ...base,
    ...partial,
    options: {
      ...base.options,
      ...partial.options,
    },
    analysis: partial.analysis ? { ...partial.analysis } : base.analysis,
  };
  return merged;
}

/**
 * 読み込んだ・複製したプリセットの形を整える。**値を足さない**——無い名前はエンジン既定で、
 * 足すと利用者が選んでいない値を送る
 */
export function normalizeOnePreset(raw: Partial<EnginePreset>): EnginePreset {
  const p = withDefaults(raw, {});

  p.label = (p.label ?? "").trim() || "";
  p.aiName = (p.aiName ?? "").trim();
  p.enginePath = (p.enginePath ?? "").trim();
  p.evalFilePath = (p.evalFilePath ?? "").trim();

  // book: 読み込みでは**パスを落とさない**（前の版は `bookEnabled: false` とパスを両方持って保存している）。
  // 使うかどうかは `bookInUse` で読む
  p.bookEnabled = Boolean(p.bookEnabled);
  const bp = (p.bookFilePath ?? "").trim();
  p.bookFilePath = bp.length > 0 ? bp : null;

  const nextOptions: UsiOptionMap = {};
  for (const [k, v] of Object.entries(p.options ?? {})) {
    const vv = String(v ?? "").trim();
    if (!vv) continue;
    nextOptions[k] = vv;
  }
  p.options = nextOptions;

  if (p.analysis) {
    const a = { ...p.analysis };
    if (a.timeSeconds != null && a.timeSeconds <= 0) delete a.timeSeconds;
    if (a.depth != null && a.depth <= 0) delete a.depth;
    if (a.nodes != null && a.nodes <= 0) delete a.nodes;
    p.analysis = a;
  }

  return p;
}

export function normalizeLoadedPresets(presets: EnginePreset[]): EnginePreset[] {
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
