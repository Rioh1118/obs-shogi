import { invoke } from "@tauri-apps/api/core";
import type { UpdaterState } from "../model/types";

/**
 * `updater.json` を読む。壊れていても Rust が既定値を返す。
 *
 * 投げるのは、設定ディレクトリそのものを解決できないときだけ。
 */
export async function loadUpdaterState(): Promise<UpdaterState> {
  return invoke<UpdaterState>("load_updater_state");
}

export async function saveUpdaterState(state: UpdaterState): Promise<void> {
  await invoke("save_updater_state", { state });
}
