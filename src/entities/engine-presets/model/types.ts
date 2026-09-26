import type { EngineRuntimeConfig } from "@/entities/engine";

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

/**
 * 読み込みで起きたこと（Rust の `PresetsNotice`）。画面の文言は種類から組む
 * （`app/providers/bridges/presetsFileNotice.ts`）
 */
export type PresetsNotice =
  | { kind: "migrated"; backup: string }
  | { kind: "backupFailed"; reason: string }
  | { kind: "migrationFailed"; reason: string }
  | { kind: "recovered"; destination: string }
  | { kind: "notRecovered"; reason: string }
  | { kind: "newerVersion"; version: number }
  | { kind: "unreadable"; reason: string };

/** 読み込みの結果（Rust の `LoadedPresets`） */
export type LoadedPresets = {
  presets: EnginePreset[];
  /** 読んだファイルの中身の印。保存に渡す。ファイルが無ければ `null` */
  revision: string | null;
  writable: boolean;
  /** 読めなかった件の数。ファイルには残してあり、保存しても消えない */
  unreadableCount: number;
  notice: PresetsNotice | null;
};

/** 保存を断った理由の種類（Rust の `SaveFailureKind`） */
export type SaveFailureKind = "conflict" | "readOnly" | "io" | "invalid";

/** 保存を断ったこと（Rust の `SaveFailure`）。`message` はログにだけ出す */
export type SaveFailure = { kind: SaveFailureKind | "unknown"; message: string };

export function isPresetConfigured(p: EnginePreset): boolean {
  return Boolean(p.aiName && p.enginePath && p.evalFilePath);
}

export type AsyncStatus = "idle" | "loading" | "ok" | "error";

export type EnginePresetsState = {
  status: AsyncStatus;
  error: string | null;
  presets: EnginePreset[];
  selectedPresetId: PresetId | null;
  /** 偽なら変更の操作を出さない（新しい版・読めない・移せなかったファイル） */
  writable: boolean;
  /** 読めなかった件の数（ファイルには残してある） */
  unreadableCount: number;
  /** 直近の読み込みで起きたこと。読み直すまで残る */
  fileNotice: PresetsNotice | null;
  /** 直近の保存の失敗。次の保存か読み直しで消える */
  saveFailure: SaveFailure | null;
};

export const initialState: EnginePresetsState = {
  status: "idle",
  error: null,
  presets: [],
  selectedPresetId: null,
  writable: false,
  unreadableCount: 0,
  fileNotice: null,
  saveFailure: null,
};

export type EnginePresetsContextType = {
  state: EnginePresetsState;

  selectedPreset: EnginePreset | null;
  runtimeConfig: EngineRuntimeConfig | null;
  analysisDefaults: AnalysisDefaults | null;
  selectedPresetVersion: number;

  reload: () => Promise<void>;

  selectPreset: (id: PresetId | null) => Promise<void>;
  /**
   * 変更の操作。**書けてから画面に反映する**（書けなかったら state は変えない）。
   * 書けなかった・書けない状態なら `null` / `false` を返し、理由は `state.saveFailure`
   */
  createPreset: (partial?: Partial<EnginePreset>) => Promise<EnginePreset | null>;
  duplicatePreset: (id: PresetId) => Promise<EnginePreset | null>;
  updatePreset: (id: PresetId, patch: Partial<EnginePreset>) => Promise<boolean>;
  mergeOptions: (id: PresetId, partial: UsiOptionMap) => Promise<boolean>;
  deletePreset: (id: PresetId) => Promise<boolean>;
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
