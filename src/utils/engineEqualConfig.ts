import type { EngineRuntimeConfig } from "@/types/engine";

export function shallowEqualOptions(
  a: Record<string, string>,
  b: Record<string, string>,
) {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

export function equalRuntime(a: EngineRuntimeConfig, b: EngineRuntimeConfig) {
  return (
    a.enginePath === b.enginePath &&
    a.workDir === b.workDir &&
    a.evalDir === b.evalDir &&
    a.bookDir === b.bookDir &&
    a.bookFile === b.bookFile &&
    shallowEqualOptions(a.options, b.options)
  );
}
