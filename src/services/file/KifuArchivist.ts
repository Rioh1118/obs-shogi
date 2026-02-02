import type { AsyncResult, FileTreeNode, KifuCreationOptions } from "@/types";
import type { FileManager } from "@/interfaces";
import {
  getFileTree,
  readFile,
  createKifuFile,
  createDirectory,
  deleteFile,
  deleteDirectory,
  renameKifuFile,
  mvKifuFile,
  renameDirectory,
  mvDirectory,
} from "@/commands/file_system";
import { createInitialJKFData } from "@/utils/fileTreeUtils";

/**
 * 棋譜ファイルの管理を専門とするアーキビスト
 * ファイルシステム操作と棋譜ファイルのフィルタリングを担当
 */
export class KifuArchivist implements FileManager {
  async getKifuFileTree(rootPath: string): AsyncResult<FileTreeNode, string> {
    try {
      const result = await getFileTree(rootPath);
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readKifuFile(node: FileTreeNode): AsyncResult<string, string> {
    try {
      const content = await readFile(node.path);
      return { success: true, data: content };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createKifuFile(
    parentPath: string,
    options: KifuCreationOptions,
  ): AsyncResult<string, string> {
    try {
      const jkfData = createInitialJKFData(options);
      const filePath = await createKifuFile(
        parentPath,
        options.fileName,
        jkfData,
      );
      return { success: true, data: filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async createDirectory(
    parentPath: string,
    dirName: string,
  ): AsyncResult<string, string> {
    try {
      const dirPath = await createDirectory(parentPath, dirName);
      return { success: true, data: dirPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteKifuFile(filePath: string): AsyncResult<void, string> {
    try {
      await deleteFile(filePath);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteDirectory(dirPath: string): AsyncResult<void, string> {
    try {
      await deleteDirectory(dirPath);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // rename / move

  async renameKifuFile(
    filePath: string,
    newFileName: string,
  ): AsyncResult<string, string> {
    try {
      const newPath = await renameKifuFile(filePath, newFileName);
      return { success: true, data: newPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async mvKifuFile(
    filePath: string,
    destDir: string,
    newFileName?: string,
  ): AsyncResult<string, string> {
    try {
      const newPath = await mvKifuFile(filePath, destDir, newFileName);
      return { success: true, data: newPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async renameDirectory(
    dirPath: string,
    newDirName: string,
  ): AsyncResult<string, string> {
    try {
      const newPath = await renameDirectory(dirPath, newDirName);
      return { success: true, data: newPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async mvDirectory(
    dirPath: string,
    destParentDir: string,
    newDirName?: string,
  ): AsyncResult<string, string> {
    try {
      const newPath = await mvDirectory(dirPath, destParentDir, newDirName);
      return { success: true, data: newPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * KifuArchivistのインスタンス生成を担当するファクトリ
 */
export class KifuArchivistFactory {
  private static instance: FileManager | null = null;

  /**
   * シングルトンパターンでKifuArchivistのインスタンスを取得
   */
  static getInstance(): FileManager {
    if (!this.instance) {
      this.instance = new KifuArchivist();
    }
    return this.instance;
  }

  /**
   * 新しいKifuArchivistインスタンスを作成
   */
  static createNew(): FileManager {
    return new KifuArchivist();
  }
}
