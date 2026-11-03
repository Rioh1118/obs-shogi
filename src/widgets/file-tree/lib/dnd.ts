import type { FileTreeNode } from "@/entities/file-tree";
import { dirname, relative, normalize } from "pathe";

export const DROP_ID = {
  blank: "drop:blank",
  root: (rootPath: string) => `drop:root:${rootPath}`,
  dir: (dirPath: string) => `drop:dir:${dirPath}`,
  file: (filePath: string) => `drop:file:${filePath}`,
} as const;

export type DropData =
  | { kind: "drop"; destDir: string }
  | { kind: "drop"; destDir: string; via: "file" | "dir" | "root" | "blank" };

export type DragData = {
  kind: "tree-node";
  path: string;
  isDirectory: boolean;
};

export function parentDir(p: string) {
  const d = dirname(normalize(p));
  return d === "." ? "" : d;
}

export function isDescendantDir(srcDir: string, destDir: string) {
  const from = normalize(srcDir);
  const to = normalize(destDir);

  if (from === to) return true;

  const rel = relative(from, to);

  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/") && !/^[a-zA-Z]:/.test(rel);
}

/**
 * 節を `destDir` へ移して何かが変わるか。
 *
 * 今いるフォルダへ落としても名前は変わらない。フォルダを自分自身か自分の下へ
 * 落とすと、移す先が移すものの中にあるので移しようがない
 */
export function canMoveInto(node: FileTreeNode, destDir: string) {
  if (normalize(parentDir(node.path)) === normalize(destDir)) return false;
  return !(node.isDirectory && isDescendantDir(node.path, destDir));
}

export function buildNodeMap(root: FileTreeNode | null) {
  const m = new Map<string, FileTreeNode>();
  if (!root) return m;

  const walk = (n: FileTreeNode) => {
    m.set(n.path, n);
    n.children?.forEach(walk);
  };
  walk(root);
  return m;
}
