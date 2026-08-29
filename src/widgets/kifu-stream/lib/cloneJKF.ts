import type { JKFData } from "@/entities/kifu/model/jkf";

export function cloneJKF(kifu: JKFData): JKFData {
  const sc = globalThis.structuredClone as ((x: JKFData) => JKFData) | undefined;
  return typeof sc === "function" ? sc(kifu) : (JSON.parse(JSON.stringify(kifu)) as JKFData);
}
