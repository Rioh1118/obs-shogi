import { basename, dirname } from "pathe";

// TODO(#216): パスの手書きヘルパが4層に4本ある。ここの `replace` は `/g` が無く、
// 区切りを1つしか置き換えない
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

export function getBaseName(path: string) {
  return basename(path);
}
