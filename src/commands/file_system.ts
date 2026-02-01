import { invoke } from "@tauri-apps/api/core";
import type { FileTreeNode, JKFData } from "@/types";
import type { RustFileTreeNode } from "@/types/rust-types";
import { RustFileTreeAdapter } from "@/adapter/fileTreeAdapter";

export async function getFileTree(rootDir: string): Promise<FileTreeNode> {
  const rustNode: RustFileTreeNode = await invoke("get_file_tree", { rootDir });
  return RustFileTreeAdapter.fromRust(rustNode);
}

export async function createKifuFile(
  parentDir: string,
  fileName: string,
  jkfData: JKFData,
): Promise<string> {
  return await invoke("create_kifu_file", { parentDir, fileName, jkfData });
}

export async function createDirectory(dirPath: string): Promise<string> {
  return await invoke("create_directory", { dirPath });
}

export async function deleteFile(filePath: string): Promise<void> {
  return await invoke("delete_file", { filePath });
}

export async function deleteDirectory(dirPath: string): Promise<void> {
  return await invoke("delete_directory", { dirPath });
}

export async function readFile(filePath: string): Promise<string> {
  return await invoke("read_file", { filePath });
}

export async function saveKifuFile(
  parentDir: string,
  fileName: string,
  content: string,
): Promise<string> {
  return await invoke("save_kifu_file", {
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
  return await invoke("rename_kifu_file", { filePath, newFileName });
}

export async function mvKifuFile(
  filePath: string,
  destDir: string,
  newFileName?: string,
): Promise<string> {
  return await invoke("mv_kifu_file", { filePath, destDir, newFileName });
}

export async function renameDirectory(
  dirPath: string,
  newDirName: string,
): Promise<string> {
  return await invoke("rename_directory", { dirPath, newDirName });
}
export async function mvDirectory(
  dirPath: string,
  destParentDir: string,
  newDirName?: string,
): Promise<string> {
  return await invoke("mv_directory", { dirPath, destParentDir, newDirName });
}
