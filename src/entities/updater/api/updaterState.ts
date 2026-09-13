import { invoke } from "@tauri-apps/api/core";
import type { UpdaterState } from "../model/types";

/**
 * `updater.json` を読む。
 *
 * **Rust 側は壊れていても既定値を返す**（`settings` crate の `updater` モジュール）。
 * ここへ来る `Err` は、設定ディレクトリそのものが解決できないときだけ。
 */
export async function loadUpdaterState(): Promise<UpdaterState> {
  return invoke<UpdaterState>("load_updater_state");
}

export async function saveUpdaterState(state: UpdaterState): Promise<void> {
  await invoke("save_updater_state", { state });
}
