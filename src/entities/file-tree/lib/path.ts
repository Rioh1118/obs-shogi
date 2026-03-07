import type { FileTreeNode } from "../model/types";

export function joinPath(parentPath: string, name: string): string {
  const trimmed = parentPath.replace(/[\\/]+$/, "");
  if (!trimmed) return name;

  const sep: "/" | "\\" =
    trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";

  return `${trimmed}${sep}${name}`;
}

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

export function scrollNodeIntoView(path: string) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const escaped =
        window.CSS?.escape?.(path) ??
        path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      const el = document.querySelector<HTMLElement>(
        `[data-node-path="${escaped}"]`,
      );

      el?.scrollIntoView({ block: "nearest" });
    });
  });
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

export function isSameOrDescendantPath(
  targetPath: string | null | undefined,
  basePath: string,
): boolean {
  if (!targetPath) return false;

  const target = trimTrailingSeparators(targetPath);
  const base = trimTrailingSeparators(basePath);

  return (
    target === base ||
    target.startsWith(`${base}/`) ||
    target.startsWith(`${base}\\`)
  );
}

export function remapSubtreePath(
  targetPath: string | null | undefined,
  oldBasePath: string,
  newBasePath: string,
): string | null {
  if (!targetPath) return null;

  const target = trimTrailingSeparators(targetPath);
  const oldBase = trimTrailingSeparators(oldBasePath);
  const newBase = trimTrailingSeparators(newBasePath);

  if (target === oldBase) return newBase;

  if (target.startsWith(`${oldBase}/`) || target.startsWith(`${oldBase}\\`)) {
    return `${newBase}${target.slice(oldBase.length)}`;
  }

  return null;
}

export function replaceBasename(path: string, nextName: string): string {
  const p = trimTrailingSeparators(path);
  const lastSlash = p.lastIndexOf("/");
  const lastBack = p.lastIndexOf("\\");
  const idx = Math.max(lastSlash, lastBack);

  if (idx < 0) return nextName;

  return `${p.slice(0, idx + 1)}${nextName}`;
}
