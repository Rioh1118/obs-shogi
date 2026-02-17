import type { FileTreeNode } from "@/types";
import { dirname, extname, relative, normalize } from "pathe";

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

export type DragData = {
  kind: "tree-node";
  path: string;
  isDirectory: boolean;
};

export function getExt(p: string) {
  return extname(p).toLowerCase();
}

export function findDropDirAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = el?.closest?.("[data-drop-dir]") as HTMLElement | null;
  return target?.dataset.dropDir ?? null;
}

export function normPath(p: string) {
  return normalize(p);
}

export function parentDir(p: string) {
  const d = dirname(normPath(p));
  return d === "." ? "" : d;
}

export function isDescendantDir(srcDir: string, destDir: string) {
  const from = normalize(srcDir);
  const to = normalize(destDir);

  if (from === to) return true;

  const rel = relative(from, to);

  return (
    rel !== "" &&
    !rel.startsWith("..") &&
    !rel.startsWith("/") &&
    !/^[a-zA-Z]:/.test(rel)
  );
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
