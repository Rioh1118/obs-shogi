import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig } from "@/types/config";

export async function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await invoke("save_config", { config });
}

export async function initRootDir(): Promise<string | null> {
  const config = await loadConfig();
  let rootDir = config.root_dir;

  if (!rootDir) {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "ルートディレクトリを選択してください",
    });

    if (!selected) throw new Error("ルートディレクトリが選択されませんでした");
    rootDir = Array.isArray(selected) ? selected[0] : selected;
    await saveConfig({ root_dir: rootDir });
  }

  return rootDir;
}
