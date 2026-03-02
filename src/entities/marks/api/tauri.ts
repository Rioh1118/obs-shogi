import { invoke } from "@tauri-apps/api/core";
import type { MarksStore } from "../model/types";

export async function loadMarks(): Promise<MarksStore> {
  return invoke<MarksStore>("load_marks");
}

export async function saveMarks(store: MarksStore): Promise<void> {
  await invoke("save_marks", { store });
}
