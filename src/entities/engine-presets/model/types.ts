import type { EngineRuntimeConfig, UsiOptionDef } from "@/entities/engine";
import type { PresetsLoadNotice, SaveFailureKind } from "../api/rust-types";

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
  /** 評価関数（絶対パス。ファイルでもフォルダでもよい）。空なら選んでいない（必須でない） */
  evalFilePath: string;

  /**
   * **解析で定跡を使うか。** 定跡を選んであるか・定跡ビューに出すかとは別（パスは切っても残る）。
   * 保存ファイルの鍵なので名前を変えていない
   */
  bookEnabled: boolean;
  /** 定跡ファイル（絶対パス）。解析で使わなくても残す（定跡ビューが出す） */
  bookFilePath: string | null;

  options: UsiOptionMap;
  analysis?: AnalysisDefaults;

  /**
   * 画面に欄を出すためのオプションの定義（申告の順）。**送る側は使わない**——起動のたびにその回の
   * 申告を見る。取っていなければ `null`
   */
  definitions?: UsiOptionDef[] | null;
  /**
   * アプリが決める名前（評価関数・定跡の欄と解析の固定値。取得の `reserved`）。**表示専用**で、
   * その欄を読み取り専用にするために残す——送る側は起動のたびに Rust が決め直す
   */
  reservedNames?: string[] | null;
  /** `definitions` を取ったエンジンのパス。`enginePath` と違えば定義は別のエンジンのもの */
  definitionsFor?: string | null;
  /** 定義を取った時刻（ISO 8601） */
  probedAt?: string | null;
  /** 申告の `id name` / `id author` */
  engineName?: string | null;
  engineAuthor?: string | null;
};

export type { LoadedPresets, PresetsLoadNotice, SaveFailureKind } from "../api/rust-types";

/** 保存を断ったこと（`asSaveFailure` で読む）。`message` はログにだけ出す */
export type SaveFailure = {
  kind: SaveFailureKind | "unknown";
  message: string;
};

/**
 * 起動できるだけ揃っているか。**評価関数は要らない**——指定できないエンジンがある
 * （流し先は起動のたびの申告から Rust が決める。受ける名前が無ければ警告になる）
 */
export function isPresetConfigured(p: EnginePreset): boolean {
  return Boolean(p.aiName && p.enginePath);
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
  loadNotice: PresetsLoadNotice | null;
  /** 読み込むたびに上がる。同じ値のまま読み直しても通知を出し直すために使う */
  loadSeq: number;
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
  loadNotice: null,
  loadSeq: 0,
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
