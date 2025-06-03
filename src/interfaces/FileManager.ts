import type { AsyncResult, FileTreeNode } from "@/types";

export interface FileManager {
  // kifファイルのみ(ディレクトリは含む)をフィルタして取得
  getKifuFileTree(rootPath: string): AsyncResult<FileTreeNode, string>;

  // kifファイルのみ読み込み
  readKifuFile(node: FileTreeNode): AsyncResult<string, string>;

  // kifファイルとして保存
  saveKifuFile(
    parentPath: string,
    fileName: string,
    content: string,
  ): AsyncResult<string, string>; // 作成されたファイルパスを返す

  //ディレクトリ作成
  createDirectory(
    parentPath: string,
    dirname: string,
  ): AsyncResult<string, string>; // 作成されたファイルパスを返す

  // ファイル削除
  deleteKifuFile(filePath: string): AsyncResult<void, string>;

  // ディレクトリ削除
  deleteDirectory(dirPath: string): AsyncResult<void, string>;

  // リネーム(移動)
  renameDirectory(oldPath: string, newPath: string): AsyncResult<void, string>;

  // ファイル存在確認
  exists(path: string): AsyncResult<boolean, string>;
}
