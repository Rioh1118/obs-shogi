import type { FileTreeNode } from "../model/types";

/**
 * ツリーの画面が描く中身が同じか。
 *
 * **`id` は比べない。** 走査のたびに振り直されるので、比べると毎回「違う」になる。
 * **`lastModified` と `size` も比べない。** 棋譜を保存するたびに変わる。比べると、
 * 中身を書き換えただけの合図（外のエディタでの保存など）でもツリーの全行が描き直される。
 * 2つを描く画面は無い。描く画面ができたら、ここで比べること
 */
export function isSameTree(a: FileTreeNode, b: FileTreeNode): boolean {
  if (
    a.name !== b.name ||
    a.path !== b.path ||
    a.isDirectory !== b.isDirectory ||
    a.truncated !== b.truncated ||
    a.kifuInfo?.format !== b.kifuInfo?.format
  ) {
    return false;
  }
  const ac = a.children;
  const bc = b.children;
  if (ac === undefined || bc === undefined) return ac === bc;
  if (ac.length !== bc.length) return false;
  return ac.every((child, i) => isSameTree(child, bc[i]));
}
