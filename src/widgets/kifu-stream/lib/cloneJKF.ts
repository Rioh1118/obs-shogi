import type { JKFData } from "@/entities/kifu";
import { sanitizeJkf } from "@/entities/kifu/lib/sanitizeJkf";

export function cloneJKF(kifu: JKFData): JKFData {
  const sc = globalThis.structuredClone as ((x: JKFData) => JKFData) | undefined;
  const cloned =
    typeof sc === "function" ? sc(kifu) : (JSON.parse(JSON.stringify(kifu)) as JKFData);
  // データは parseKifuContentToJKF 時点で sanitize 済み。
  // ここでも適用することで、テスト等で未 sanitize データが渡された場合の安全網とする。
  return sanitizeJkf(cloned);
}
