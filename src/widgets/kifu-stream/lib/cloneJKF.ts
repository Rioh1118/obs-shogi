import type { JKFData } from "@/entities/kifu";

export function cloneJKF(kifu: JKFData): JKFData {
  const sc = globalThis.structuredClone as
    | ((x: JKFData) => JKFData)
    | undefined;
  if (typeof sc === "function") return sc(kifu);
  return JSON.parse(JSON.stringify(kifu)) as JKFData;
}
