import type { FileTreeNode } from "@/types";

export const ALLOWED = new Set([".kif", ".ki2", ".csa", ".jkf"]);

export const DROP_ID = {
  blank: "drop:blank",
  root: (rootPath: string) => `drop:root:${rootPath}`,
  dir: (dirPath: string) => `drop:dir:${dirPath}`,
  file: (filePath: string) => `drop:file:${filePath}`,
} as const;

export type DropData =
  | { kind: "drop"; destDir: string }
  | { kind: "drop"; destDir: string; via: "file" | "dir" | "root" | "blank" };

type DragData = { kind: "tree-node"; path: string; isDirectory: boolean };

export function getExt(p: string) {
  const m = p.toLowerCase().match(/\.[^./\\]+$/);
  return m?.[0] ?? "";
}

export function findDropDirAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = el?.closest?.("[data-drop-dir]") as HTMLElement | null;
  return target?.dataset.dropDir ?? null;
}

export function normPath(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function parentDir(p: string) {
  const s = p.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(0, i) : "";
}

export function isDescendantDir(srcDir: string, destDir: string) {
  // destDir が srcDir 配下なら true
  const a = normPath(srcDir) + "/";
  const b = normPath(destDir) + "/";
  return b.startsWith(a);
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
