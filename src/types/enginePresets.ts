export type PresetId = string;

export type UsiOptionMap = Record<string, string>;

export type AnalysisDefaults = {
  timeSeconds?: number;
  depth?: number;
  nodes?: number;
  mateSearch: boolean; // バックエンドに機能なし。フロントでは保持する。
};

export type EnginePreset = {
  id: PresetId;
  label: string;

  aiName: string;

  // 実体（絶対パス）
  enginePath: string;
  evalFilePath: string;

  // bookは任意
  bookEnabled: boolean;
  bookFilePath: string | null;

  options: UsiOptionMap;
  analysis?: AnalysisDefaults; // バックエンドになし。フロントでは保持。
};

export type PresetsFile = {
  presets: EnginePreset[];
};

export function isPresetConfigured(p: EnginePreset): boolean {
  return Boolean(p.aiName && p.enginePath && p.evalFilePath);
}
