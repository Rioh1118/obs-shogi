import type { FileTreeNode } from "../model/types";

/** 根から `targetPath` の節までの列を返す。無ければ `null`。`chain` は再帰の途中の列 */
export function findNodeChain(
  node: FileTreeNode,
  targetPath: string,
  chain: FileTreeNode[] = [],
): FileTreeNode[] | null {
  const nextChain = [...chain, node];

  if (node.path === targetPath) return nextChain;

  for (const child of node.children ?? []) {
    const found = findNodeChain(child, targetPath, nextChain);
    if (found) return found;
  }

  return null;
}

/** `targetPath` の節を返す。無ければ `null` */
export function findNode(root: FileTreeNode, targetPath: string): FileTreeNode | null {
  const chain = findNodeChain(root, targetPath);
  return chain ? chain[chain.length - 1] : null;
}

/**
 * `id` の節を返す。無ければ `null`。
 *
 * `id` は走査のたびに振り直されるので、引けるのは同じ走査で取ったツリーからだけ
 */
export function findNodeById(node: FileTreeNode, id: string): FileTreeNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}
