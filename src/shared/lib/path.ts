import { dirname } from "pathe";

const norm = (p: string) => p.replace("\\", "/");

export function toRelPath(absPath: string, rootDir: string | null): string {
  const a = norm(absPath);
  if (!rootDir) return a;
  let r = norm(rootDir);
  if (!r.endsWith("/")) r += "/";
  return a.startsWith(r) ? a.slice(r.length) : a;
}

export function getParentPath(path: string) {
  return dirname(path);
}
