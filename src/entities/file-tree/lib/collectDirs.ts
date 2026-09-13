import type { FileTreeNode } from "../model/types";

interface DirOption {
  value: string;
  label: string;
}

/**
 * ツリーのフォルダを平らな一覧にする（保存先を選ぶ欄のため）
 *
 * **root だけは `/` と綴る。** 絶対パスをそのまま出すと、どの行も同じ長い接頭辞で
 * 始まって、末尾の差だけで読み分けることになる。root からの相対で書けば、
 * 一覧の先頭が意味のある文字から始まる。
 *
 * 順序は木の並び（深さ優先）。並べ替えると、隣り合っていたフォルダが離れて
 * 「どの階層の話か」が読めなくなる。
 */
export function collectDirs(node: FileTreeNode, rootPath: string): DirOption[] {
  const dirs: DirOption[] = [];

  function walk(current: FileTreeNode) {
    if (!current.isDirectory) return;
    dirs.push({
      value: current.path,
      label: current.path === rootPath ? "/" : current.path.slice(rootPath.length),
    });
    for (const child of current.children ?? []) walk(child);
  }

  walk(node);
  return dirs;
}
