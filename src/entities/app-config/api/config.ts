import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../model/types";

export async function loadConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("load_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await invoke("save_config", { config });
}

/**
 * 読めなかった `app.json` を退避し、退避先を返す。元のファイルが無ければ `null`。
 *
 * 上書きの前に呼ぶ。`save_config` はファイルごと置き換えるので、読めなかった設定の上に
 * 組み立てた値を書くと、読めていない欄が `null` で書き潰される。
 * 壊れた JSON でも、中の文字列は利用者が選んだ場所そのもの。
 */
export async function backupBrokenConfig(): Promise<string | null> {
  return invoke<string | null>("backup_broken_config");
}
