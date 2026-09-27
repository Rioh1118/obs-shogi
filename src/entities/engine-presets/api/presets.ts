import { invoke } from "@tauri-apps/api/core";
import type { EnginePreset } from "../model/types";
import type { LoadedPresets } from "./rust-types";

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
