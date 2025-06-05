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
