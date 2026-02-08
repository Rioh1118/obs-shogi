import { invoke } from "@tauri-apps/api/core";

export type FsKind = "file" | "dir" | "symlink" | "unknown";

export type DirInfo = {
  path: string;
  exists: boolean;
  kind: FsKind;
};

export type EngineCandidate = {
  entry: string;
  path: string;
  kind: FsKind;
};

export type ProfileCandidate = {
  name: string;
  path: string;
  has_eval_dir: boolean;
  has_book_dir: boolean;
  has_nn_bin: boolean;
  book_db_files: string[];
};

export type AiRootIndex = {
  ai_root: string;
  engines_dir: DirInfo;
  engines: EngineCandidate[];
  profiles: ProfileCandidate[];
};

export type WorkDirPolicy = "profile_dir" | "engine_dir" | "custom";

export type EngineSetupDraft = {
  ai_root: string | null;
  engine_entry: string | null;
  profile_name: string | null;

  eval_dir_name: string;
  book_dir_name: string;
  nn_file_name: string;
  book_file_name: string;

  work_dir_policy: WorkDirPolicy;
  custom_work_dir?: string | null;
};

export type ResolvedEnginePaths = {
  ai_root: string;
  engines_dir: string;
  engine_path: string;

  profile_dir: string;
  eval_dir: string;
  nn_path: string;

  book_dir: string;
  book_path: string;

  work_dir: string;
};

export type PathCheck = {
  key: string;
  path: string;
  exists: boolean;
  kind: FsKind;
};

export type EngineSetupCheck = {
  configured: boolean;
  ok: boolean;
  resolved: ResolvedEnginePaths | null;
  checks: PathCheck[];
};

export async function scanAiRoot(aiRoot: string): Promise<AiRootIndex> {
  return await invoke("scan_ai_root", { aiRoot });
}

export async function ensureEnginesDir(aiRoot: string): Promise<string> {
  return await invoke("ensure_engines_dir", { aiRoot });
}

export async function checkEngineSetup(
  draft: EngineSetupDraft,
): Promise<EngineSetupCheck> {
  return await invoke("check_engine_setup", { draft });
}
