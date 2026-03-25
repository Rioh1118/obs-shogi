import { invoke } from "@tauri-apps/api/core";
import type { StudyPositionsFile } from "../model/types";

export async function loadStudyPositions(): Promise<StudyPositionsFile> {
  return await invoke<StudyPositionsFile>("load_study_positions");
}

export async function saveStudyPositions(input: StudyPositionsFile): Promise<void> {
  await invoke("save_study_positions", { input });
}
