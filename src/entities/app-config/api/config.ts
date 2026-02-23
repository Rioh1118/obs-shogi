import type { AppConfig } from "@/types/config";
import { invoke } from "@tauri-apps/api/core";

export async function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await invoke("save_config", { config });
}
