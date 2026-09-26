import type { EnginePreset } from "../model/types";

/**
 * 読み込みで起きたこと（Rust の `PresetsLoadNotice`）。画面の文言は種類から組む
 * （`app/providers/bridges/presetsFileNotice.ts`）
 */
export type PresetsLoadNotice =
  | { kind: "migrated"; from: number; backup: string }
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
  loadNotice: PresetsLoadNotice | null;
};

/** 保存を断った理由の種類（Rust の `SaveFailureKind`） */
export type SaveFailureKind = "conflict" | "readOnly" | "io" | "invalid";
