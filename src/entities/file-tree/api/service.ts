import { asFsError, type FsError } from "./error";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import type { FileTreeNode } from "../model/types";
import type { KifuCreationOptions } from "@/entities/kifu/model/kifu";
import * as fs from "./fileSystem";
import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import { createInitialJKFData } from "@/entities/kifu/lib/createInitialJKFData";

/** `run` の成否を `FsError` の `Result` へ畳む */
async function attempt<T>(run: () => Promise<T>): AsyncResult<T, FsError> {
  try {
    return Ok(await run());
  } catch (e) {
    return Err(asFsError(e));
  }
}

export function fetchTree(rootPath: string): AsyncResult<FileTreeNode, FsError> {
  return attempt(() => fs.getFileTree(rootPath));
}

/**
 * テキストとして読む。投げない。
 *
 * `api/fileSystem` の `readFile` は投げるので、呼び手が `catch {}` で握り潰すと、
 * 権限も見つからないも同じ「何も出ない」に落ちる。公開面にはこちらだけを出す
 */
export function readText(path: string): AsyncResult<string, FsError> {
  return attempt(() => fs.readFile(path));
}

export async function readKifu(node: FileTreeNode): AsyncResult<string, FsError> {
  const read = await readText(node.path);
  if (read.success) return read;

  // Rust は `io::Error` 由来の失敗（権限が無い、ボリュームが外れた）に `path` を積まない。
  // 読み手は `path` でどの棋譜の失敗かを判定するので、ここで補う
  const { error } = read;
  return Err(error.path ? error : { ...error, path: node.path });
}

export function createKifu(
  parentPath: string,
  opt: KifuCreationOptions,
): AsyncResult<string, FsError> {
  return attempt(() => fs.createKifuFile(parentPath, opt.fileName, createInitialJKFData(opt)));
}

export function importKifu(
  parentPath: string,
  fileName: string,
  raw: string,
): AsyncResult<string, FsError> {
  return attempt(() => fs.importKifuFile(parentPath, fileName, parseKifuStringToJKF(raw).jkf));
}

export function createDir(parentPath: string, dirName: string): AsyncResult<string, FsError> {
  return attempt(() => fs.createDirectory(parentPath, dirName));
}

/** Rust の `()` は `null` で届く。`void` の `data` は `undefined` に揃える */
export function removeFile(path: string): AsyncResult<void, FsError> {
  return attempt(async () => {
    await fs.deleteFile(path);
  });
}

export function removeDir(path: string): AsyncResult<void, FsError> {
  return attempt(async () => {
    await fs.deleteDirectory(path);
  });
}

export function renameFile(path: string, newName: string): AsyncResult<string, FsError> {
  return attempt(() => fs.renameKifuFile(path, newName));
}

export function moveFile(
  path: string,
  destDir: string,
  newName?: string,
): AsyncResult<string, FsError> {
  return attempt(() => fs.mvKifuFile(path, destDir, newName));
}

export function renameDir(path: string, newName: string): AsyncResult<string, FsError> {
  return attempt(() => fs.renameDirectory(path, newName));
}

export function moveDir(
  path: string,
  destParentDir: string,
  newName?: string,
): AsyncResult<string, FsError> {
  return attempt(() => fs.mvDirectory(path, destParentDir, newName));
}
