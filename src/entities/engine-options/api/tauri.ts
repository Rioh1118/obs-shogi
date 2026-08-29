import { invoke } from "@tauri-apps/api/core";
import type { EngineOption } from "@/entities/engine/api/rust-types";

export async function getEngineOptions(enginePath: string): Promise<EngineOption[]> {
  return await invoke<EngineOption[]>("get_engine_options", { enginePath });
}

export async function rescanEngineOptions(enginePath: string): Promise<EngineOption[]> {
  return await invoke<EngineOption[]>("rescan_engine_options", { enginePath });
}
