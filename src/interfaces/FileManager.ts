import type { AsyncResult, FileTreeNode, KifuCreationOptions } from "@/types";

export interface FileManager {
  // kifファイルのみ(ディレクトリは含む)をフィルタして取得
  getKifuFileTree(rootPath: string): AsyncResult<FileTreeNode, string>;

  // kifファイルのみ読み込み
  readKifuFile(node: FileTreeNode): AsyncResult<string, string>;

  createKifuFile(
    parentPath: string,
    options: KifuCreationOptions,
  ): AsyncResult<string, string>; // 作成あれたファイルのパスを返す

  //ディレクトリ作成
  createDirectory(
    parentPath: string,
    dirname: string,
  ): AsyncResult<string, string>; // 作成されたファイルパスを返す

  // ファイル削除
  deleteKifuFile(filePath: string): AsyncResult<void, string>;

  // ディレクトリ削除
  deleteDirectory(dirPath: string): AsyncResult<void, string>;

  // rename/move
  renameKifuFile(
    filePath: string,
    newFileName: string,
  ): AsyncResult<string, string>;

  mvKifuFile(
    filePath: string,
    destDir: string,
    newFileName?: string,
  ): AsyncResult<string, string>;

  renameDirectory(
    dirPath: string,
    newDirName: string,
  ): AsyncResult<string, string>;

  mvDirectory(
    dirPath: string,
    destParentDir: string,
    newDirName?: string,
  ): AsyncResult<string, string>;
}
