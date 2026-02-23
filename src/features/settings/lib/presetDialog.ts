import type { FileCandidate, ProfileCandidate } from "@/commands/ai_library";

export const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

export function deepClone<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

export function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function parseIntSafe(v: unknown, fallback: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function cleanText(s: string) {
  return (s ?? "").trim();
}

export function basename(p: string) {
  const s = (p ?? "").replace(/\\/g, "/");
  const last = s.split("/").filter(Boolean).pop();
  return last || (p ?? "");
}

export const QUICK_MULTIPV = [1, 3, 5, 8] as const;
export const QUICK_MULTIPV_SET = new Set<number>(QUICK_MULTIPV);
export const MULTIPV_MIN = 1;
export const MULTIPV_MAX = 8;

export const HASH_CHOICES = [256, 512, 1024, 2048, 4096, 8192, 16384] as const;

export function pickDefaultEvalFile(
  profile: ProfileCandidate | null,
): FileCandidate | null {
  const xs = profile?.eval_files ?? [];
  if (xs.length === 0) return null;
  return xs.find((f) => f.entry === "nn.bin") ?? xs[0];
}

export function pickDefaultBookDb(
  profile: ProfileCandidate | null,
): FileCandidate | null {
  const xs = profile?.book_db_files ?? [];
  if (xs.length === 0) return null;
  return xs[0];
}
