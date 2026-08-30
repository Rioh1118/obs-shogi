import { invoke } from "@tauri-apps/api/core";
import { asFsError, type FsError } from "@/entities/file-tree";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";

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
 * ワークスペース配下かの関門を通るコマンドでは作れない。
 * 理由は Rust の `create_ai_profile_dirs` の doc
 */
/**
 * AI プロファイルのフォルダを作る。
 *
 * **失敗は `FsError` で返す。** 呼び出し元は code を見て、名前の欄のそばに出すか
 * （名前を直せば通る失敗）、AI ルートの診断側へ回すかを決める。`string` に潰すと
 * 「AI ルートが無い」まで名前が悪いという位置に出る
 */
export async function createAiProfileDirs(
  aiRoot: string,
  name: string,
): AsyncResult<string, FsError> {
  try {
    return Ok(await invoke<string>("create_ai_profile_dirs", { aiRoot, name }));
  } catch (e) {
    return Err(asFsError(e));
  }
}
