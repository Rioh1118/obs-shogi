import type { FileTreeNode } from "@/entities/file-tree/model/types";

/**
 * ワークスペースそのものを指すパスか。
 *
 * **比べる相手は「いま読み込んでいるツリーの根」で、設定に保存された文字列ではない。**
 * `config.root_dir` はディレクトリを選ぶダイアログが返した値をそのまま保存したもので、
 * ツリーの各ノードの `path` は Rust が `canonicalize` した結果から組み立てられる。
 * symlink 成分が1つでもあると両者は一致しない（macOS で `/tmp/kifu` を選ぶと
 * 実体は `/private/tmp/kifu`）。一致しないと、削除を禁じるはずのメニューが
 * ワークスペース全消しを許し、改名は `setRootDir` を通らずに古い場所を読み直す。
 *
 * 削除の禁止そのものは Rust（`delete_directory` の `root_not_deletable`）が持つ。
 * ここが決めるのは**画面に出すかどうか**だけ。
 */
export function isProjectRoot(path: string, fileTree: FileTreeNode | null): boolean {
  return fileTree !== null && path === fileTree.path;
}
