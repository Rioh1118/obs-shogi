import { invoke } from "@tauri-apps/api/core";

export type FsKind = "file" | "dir" | "symlink" | "unknown";

export type DirInfo = {
  path: string; // full path
  exists: boolean;
  kind: FsKind;
};

export type EngineCandidate = {
  entry: string; // file name under engines/
  path: string; // full path
  kind: FsKind;
};

export type FileCandidate = {
  entry: string; // file name
  path: string; // full path
  kind: FsKind;
};

export type ProfileCandidate = {
  name: string; // directory name under ai_root
  path: string; // full path

  has_eval_dir: boolean;
  has_book_dir: boolean;

  eval_files: FileCandidate[]; // full path candidates under <profile>/eval
  book_db_files: FileCandidate[]; // full path candidates under <profile>/book (db only)
};

export type AiRootIndex = {
  ai_root: string;
  engines_dir: DirInfo;
  engines: EngineCandidate[];
  profiles: ProfileCandidate[];
};

export async function scanAiRoot(aiRoot: string): Promise<AiRootIndex> {
  return await invoke("scan_ai_root", { aiRoot });
}

export async function ensureEnginesDir(aiRoot: string): Promise<string> {
  return await invoke("ensure_engines_dir", { aiRoot });
}

/**
 * AI プロファイル（`<ai_root>/<name>/{eval,book}`）を作る。
 *
 * **`entities/file-tree` の `createDir` は使えない。** あちらはワークスペース配下かの
 * 関門を通るコマンドを呼ぶので、別に選ぶ `ai_root` の下では必ず弾かれる
 */
export async function createAiProfileDirs(aiRoot: string, name: string): Promise<string> {
  return await invoke("create_ai_profile_dirs", { aiRoot, name });
}
