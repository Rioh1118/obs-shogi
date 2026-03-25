import type { AsyncResult } from "@/shared/lib/result";
import type { FileTreeNode } from "../model/types";
import type { KifuCreationOptions } from "@/entities/kifu";
import type { JKFData } from "@/entities/kifu";

import * as fs from "./fileSystem";
import { createInitialJKFData, parseKifuStringToJKF } from "@/entities/kifu";
import type { FsError } from "./error";

export async function fetchTree(rootPath: string): AsyncResult<FileTreeNode, FsError> {
  try {
    const tree = await fs.getFileTree(rootPath);
    return { success: true, data: tree };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function readKifu(node: FileTreeNode): AsyncResult<string, FsError> {
  try {
    const content = await fs.readFile(node.path);
    return { success: true, data: content };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function createKifu(
  parentPath: string,
  opt: KifuCreationOptions,
): AsyncResult<string, FsError> {
  try {
    const jkf: JKFData = createInitialJKFData(opt);
    const path = await fs.createKifuFile(parentPath, opt.fileName, jkf);
    return { success: true, data: path };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function importKifu(
  parentPath: string,
  fileName: string,
  raw: string,
): AsyncResult<string, FsError> {
  try {
    const parsed = parseKifuStringToJKF(raw);
    const path = await fs.importKifuFile(parentPath, fileName, parsed.jkf);
    return { success: true, data: path };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function createDir(parentPath: string, dirName: string): AsyncResult<string, FsError> {
  try {
    const path = await fs.createDirectory(parentPath, dirName);
    return { success: true, data: path };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function removeFile(path: string): AsyncResult<void, FsError> {
  try {
    await fs.deleteFile(path);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function removeDir(path: string): AsyncResult<void, FsError> {
  try {
    await fs.deleteDirectory(path);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function renameFile(path: string, newName: string): AsyncResult<string, FsError> {
  try {
    const next = await fs.renameKifuFile(path, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function moveFile(
  path: string,
  destDir: string,
  newName?: string,
): AsyncResult<string, FsError> {
  try {
    const next = await fs.mvKifuFile(path, destDir, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function renameDir(path: string, newName: string): AsyncResult<string, FsError> {
  try {
    const next = await fs.renameDirectory(path, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}

export async function moveDir(
  path: string,
  destParentDir: string,
  newName?: string,
): AsyncResult<string, FsError> {
  try {
    const next = await fs.mvDirectory(path, destParentDir, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: e as FsError };
  }
}
