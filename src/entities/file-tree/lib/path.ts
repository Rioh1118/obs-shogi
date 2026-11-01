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

  return target === base || target.startsWith(`${base}/`) || target.startsWith(`${base}\\`);
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
