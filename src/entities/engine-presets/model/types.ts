import type { EngineRuntimeConfig } from "@/types/engine";

export type PresetId = string;
export type UsiOptionMap = Record<string, string>;

export type AnalysisDefaults = {
  timeSeconds?: number;
  depth?: number;
  nodes?: number;
  mateSearch: boolean;
};

export type EnginePreset = {
  id: PresetId;
  label: string;

  aiName: string;
  enginePath: string;
  evalFilePath: string;

  bookEnabled: boolean;
  bookFilePath: string | null;

  options: UsiOptionMap;
  analysis?: AnalysisDefaults;
};

export type PresetsFile = {
  presets: EnginePreset[];
};

export function isPresetConfigured(p: EnginePreset): boolean {
  return Boolean(p.aiName && p.enginePath && p.evalFilePath);
}

export type AsyncStatus = "idle" | "loading" | "ok" | "error";

export type EnginePresetsState = {
  status: AsyncStatus;
  error: string | null;
  presets: EnginePreset[];
  selectedPresetId: PresetId | null;
};

export const initialState: EnginePresetsState = {
  status: "idle",
  error: null,
  presets: [],
  selectedPresetId: null,
};

export type EnginePresetsContextType = {
  state: EnginePresetsState;

  selectedPreset: EnginePreset | null;
  runtimeConfig: EngineRuntimeConfig | null;
  analysisDefaults: AnalysisDefaults | null;
  selectedPresetVersion: number;

  reload: () => Promise<void>;

  selectPreset: (id: PresetId | null) => Promise<void>;
  createPreset: (partial?: Partial<EnginePreset>) => Promise<EnginePreset>;
  duplicatePreset: (id: PresetId) => Promise<EnginePreset | null>;
  updatePreset: (id: PresetId, patch: Partial<EnginePreset>) => Promise<void>;
  mergeOptions: (id: PresetId, partial: UsiOptionMap) => Promise<void>;
  deletePreset: (id: PresetId) => Promise<void>;
};

export type EnginePresetsProviderProps = {
  children: React.ReactNode;

  /** AppConfig から注入（entity間依存を消す） */
  aiRoot: string | null;
  initialSelectedPresetId: PresetId | null;
  onSelectedPresetIdChange?: (id: PresetId | null) => Promise<void> | void;

  /** AppConfig のロード待ち等で Provider の初期化を遅らせたい時 */
  enabled?: boolean;
};
