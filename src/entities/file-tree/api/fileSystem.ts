import { invoke } from "@tauri-apps/api/core";
import type { JKFData } from "@/entities/kifu/model/jkf";
import type { FileTreeNode } from "../model/types";
import { toFileTreeNode } from "./adapter";
import type { RustFileTreeNode } from "./rust-types";

export async function getFileTree(rootDir: string): Promise<FileTreeNode> {
  const rustNode = await invoke<RustFileTreeNode>("get_file_tree", {
    rootDir,
  });
  return toFileTreeNode(rustNode);
}

export async function createKifuFile(
  parentDir: string,
  fileName: string,
  jkfData: JKFData,
): Promise<string> {
  return await invoke<string>("create_kifu_file", {
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
  return await invoke<string>("import_kifu_file", {
    parentDir,
    fileName,
    jkfData,
  });
}

export async function createDirectory(parentDir: string, dirName: string): Promise<string> {
  return await invoke<string>("create_directory", { parentDir, dirName });
}

export async function deleteFile(filePath: string): Promise<void> {
  return await invoke<void>("delete_file", { filePath });
}

export async function deleteDirectory(dirPath: string): Promise<void> {
  return await invoke<void>("delete_directory", { dirPath });
}

export async function readFile(filePath: string): Promise<string> {
  return await invoke<string>("read_file", { filePath });
}

export async function renameKifuFile(filePath: string, newFileName: string): Promise<string> {
  return await invoke<string>("rename_kifu_file", { filePath, newFileName });
}

export async function mvKifuFile(
  filePath: string,
  destDir: string,
  newFileName?: string,
): Promise<string> {
  return await invoke<string>("mv_kifu_file", {
    filePath,
    destDir,
    newFileName,
  });
}

export async function renameDirectory(dirPath: string, newDirName: string): Promise<string> {
  return await invoke<string>("rename_directory", { dirPath, newDirName });
}

export async function mvDirectory(
  dirPath: string,
  destParentDir: string,
  newDirName?: string,
): Promise<string> {
  return await invoke<string>("mv_directory", {
    dirPath,
    destParentDir,
    newDirName,
  });
}
