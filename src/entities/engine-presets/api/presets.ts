import { invoke } from "@tauri-apps/api/core";
import type { EnginePreset, LoadedPresets, SaveFailure, SaveFailureKind } from "../model/types";

/** 読み込む。古い版のファイルは Rust がここで移す（`presets::load_from`） */
export async function loadPresets(): Promise<LoadedPresets> {
  return invoke<LoadedPresets>("load_presets");
}

/**
 * 書く。`expectedRevision` は読み込み（か直前の保存）で受け取った印。成功したら新しい印を返す。
 * 断るときは `SaveFailure`（`asSaveFailure` で読む）
 */
export async function savePresets(
  presets: EnginePreset[],
  expectedRevision: string | null,
): Promise<string> {
  return invoke<string>("save_presets", { presets, expectedRevision });
}

const SAVE_FAILURE_KINDS = {
  conflict: true,
  readOnly: true,
  io: true,
  invalid: true,
} satisfies Record<SaveFailureKind, true>;

/** `invoke` が投げた値を読む。**形を信じない**——知らない種類は `unknown` に落とす */
export function asSaveFailure(error: unknown): SaveFailure {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const { kind, message } = error as { kind: unknown; message?: unknown };
    const text = typeof message === "string" ? message : String(error);
    const known =
      typeof kind === "string" && Object.prototype.hasOwnProperty.call(SAVE_FAILURE_KINDS, kind);
    return { kind: known ? (kind as SaveFailureKind) : "unknown", message: text };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}
