import type { AsyncResult } from "@/shared/lib/result";
import type { FileTreeNode } from "../model/types";
import type { KifuCreationOptions } from "@/entities/kifu";
import type { JKFData } from "@/entities/kifu";

import * as fs from "./fileSystem";
import { createInitialJKFData, parseKifuStringToJKF } from "@/entities/kifu";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function fetchTree(
  rootPath: string,
): AsyncResult<FileTreeNode, string> {
  try {
    const tree = await fs.getFileTree(rootPath);
    return { success: true, data: tree };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function readKifu(
  node: FileTreeNode,
): AsyncResult<string, string> {
  try {
    const content = await fs.readFile(node.path);
    return { success: true, data: content };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function createKifu(
  parentPath: string,
  opt: KifuCreationOptions,
): AsyncResult<string, string> {
  try {
    const jkf: JKFData = createInitialJKFData(opt);
    const path = await fs.createKifuFile(parentPath, opt.fileName, jkf);
    return { success: true, data: path };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function importKifu(
  parentPath: string,
  fileName: string,
  raw: string,
): AsyncResult<string, string> {
  try {
    const parsed = parseKifuStringToJKF(raw);
    const path = await fs.importKifuFile(parentPath, fileName, parsed.jkf);
    return { success: true, data: path };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function createDir(
  parentPath: string,
  dirName: string,
): AsyncResult<string, string> {
  try {
    const path = await fs.createDirectory(parentPath, dirName);
    return { success: true, data: path };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function removeFile(path: string): AsyncResult<void, string> {
  try {
    await fs.deleteFile(path);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function removeDir(path: string): AsyncResult<void, string> {
  try {
    await fs.deleteDirectory(path);
    return { success: true, data: undefined };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function renameFile(
  path: string,
  newName: string,
): AsyncResult<string, string> {
  try {
    const next = await fs.renameKifuFile(path, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function moveFile(
  path: string,
  destDir: string,
  newName?: string,
): AsyncResult<string, string> {
  try {
    const next = await fs.mvKifuFile(path, destDir, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function renameDir(
  path: string,
  newName: string,
): AsyncResult<string, string> {
  try {
    const next = await fs.renameDirectory(path, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}

export async function moveDir(
  path: string,
  destParentDir: string,
  newName?: string,
): AsyncResult<string, string> {
  try {
    const next = await fs.mvDirectory(path, destParentDir, newName);
    return { success: true, data: next };
  } catch (e) {
    return { success: false, error: errMsg(e) };
  }
}
