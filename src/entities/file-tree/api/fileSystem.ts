import type { JKFData } from "@/entities/kifu";
import type { RustFileTreeNode } from "./rust-types";
import { RustFileTreeAdapter } from "./adapter";
import type { FileTreeNode } from "../model/types";

import { invoke } from "@tauri-apps/api/core";
import type { FsError } from "./error";

async function invokeFs<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error as FsError;
  }
}

export async function getFileTree(rootDir: string): Promise<FileTreeNode> {
  const rustNode = await invokeFs<RustFileTreeNode>("get_file_tree", {
    rootDir,
  });
  return RustFileTreeAdapter.fromRust(rustNode);
}

export async function createKifuFile(
  parentDir: string,
  fileName: string,
  jkfData: JKFData,
): Promise<string> {
  return await invokeFs<string>("create_kifu_file", {
    parentDir,
    fileName,
    jkfData,
  });
}

export async function importKifuFile(
  parentDir: string,
  fileName: string,
  jkfData: JKFData,
): Promise<string> {
  return await invokeFs<string>("import_kifu_file", {
    parentDir,
    fileName,
    jkfData,
  });
}

export async function createDirectory(
  parentDir: string,
  dirName: string,
): Promise<string> {
  return await invokeFs<string>("create_directory", { parentDir, dirName });
}

export async function deleteFile(filePath: string): Promise<void> {
  return await invokeFs<void>("delete_file", { filePath });
}

export async function deleteDirectory(dirPath: string): Promise<void> {
  return await invokeFs<void>("delete_directory", { dirPath });
}

export async function readFile(filePath: string): Promise<string> {
  return await invokeFs<string>("read_file", { filePath });
}

export async function saveKifuFile(
  parentDir: string,
  fileName: string,
  content: string,
): Promise<string> {
  return await invokeFs<string>("save_kifu_file", {
    parentDir,
    fileName,
    content,
  });
}

// mv / rename

export async function renameKifuFile(
  filePath: string,
  newFileName: string,
): Promise<string> {
  return await invokeFs<string>("rename_kifu_file", { filePath, newFileName });
}

export async function mvKifuFile(
  filePath: string,
  destDir: string,
  newFileName?: string,
): Promise<string> {
  return await invokeFs<string>("mv_kifu_file", {
    filePath,
    destDir,
    newFileName,
  });
}

export async function renameDirectory(
  dirPath: string,
  newDirName: string,
): Promise<string> {
  return await invokeFs<string>("rename_directory", { dirPath, newDirName });
}
export async function mvDirectory(
  dirPath: string,
  destParentDir: string,
  newDirName?: string,
): Promise<string> {
  return await invokeFs<string>("mv_directory", {
    dirPath,
    destParentDir,
    newDirName,
  });
}
