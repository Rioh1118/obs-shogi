import { invoke } from "@tauri-apps/api/core";
import type { FileTreeNode } from "@/types";
import type { RustFileTreeNode } from "@/types/rust-types";
import { RustFileTreeAdapter } from "@/adapter/fileTreeAdapter";

export async function getFileTree(rootDir: string): Promise<FileTreeNode> {
  const rustNode: RustFileTreeNode = await invoke("get_file_tree", { rootDir });
  return RustFileTreeAdapter.fromRust(rustNode);
}

export async function createFile(
  filePath: string,
  content?: string,
): Promise<void> {
  return await invoke("create_file", { filePath, content });
}

export async function createDirectory(dirPath: string): Promise<void> {
  return await invoke("create_directory", { dirPath });
}

export async function deleteFile(filePath: string): Promise<void> {
  return await invoke("delete_file", { filePath });
}

export async function deleteDirectory(dirPath: string): Promise<void> {
  return await invoke("delete_directory", { dirPath });
}

export async function renameFile(
  oldPath: string,
  newPath: string,
): Promise<void> {
  return await invoke("rename_file", { oldPath, newPath });
}

export async function readFile(filePath: string): Promise<string> {
  return await invoke("read_file", { filePath });
}

export async function writeFile(
  filePath: string,
  content: string,
): Promise<void> {
  return await invoke("write_file", { filePath, content });
}
