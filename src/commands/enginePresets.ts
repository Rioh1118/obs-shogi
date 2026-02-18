import { invoke } from "@tauri-apps/api/core";
import type { PresetsFile } from "@/types/enginePresets";

export async function loadPresets(): Promise<PresetsFile> {
  return invoke<PresetsFile>("load_presets");
}

export async function savePresets(file: PresetsFile): Promise<void> {
  await invoke("save_presets", { file });
}
