import type {
  EngineCandidate,
  FileCandidate,
  ProfileCandidate,
} from "@/entities/engine/api/aiLibrary";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");

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

export function pickDefaultEvalFile(profile: ProfileCandidate | null): FileCandidate | null {
  const xs = profile?.eval_files ?? [];
  if (xs.length === 0) return null;
  return xs.find((f) => f.entry === "nn.bin") ?? xs[0];
}

export function pickDefaultBookDb(profile: ProfileCandidate | null): FileCandidate | null {
  const xs = profile?.book_db_files ?? [];
  if (xs.length === 0) return null;
  return xs[0];
}

/**
 * 候補が届いた時点で、**空の欄だけ**を埋める（`docs/spec/screens/engine-preset-dialog.md`）。
 *
 * **1つも埋めなかったら同じ参照を返す。** 呼び出し元はこの結果を `setDraft` に載せ、
 * その `draft` を effect の依存に持っている。毎回新しいオブジェクトを返すと
 * commit → effect → `setDraft` → commit … が閉じて、ダイアログを開いている間ずっと回る
 * （欄が全部埋まっている回でも、候補が0件の回でも止まらない）。
 *
 * すでに入っている値は上書きしない。`book` だけは「使わない」に切り替えた回に
 * 落とす必要があるので、空でなくても触る。
 */
export function autofillPreset(
  cur: EnginePreset,
  candidates: {
    profiles: ProfileCandidate[];
    engines: EngineCandidate[];
    filteredEngines: EngineCandidate[];
  },
): EnginePreset {
  const { profiles, engines, filteredEngines } = candidates;
  const next = { ...cur };
  let changed = false;

  if (!cleanText(next.aiName)) {
    const p = profiles.find((x) => x.has_eval_dir) ?? profiles[0] ?? null;
    if (p) {
      next.aiName = p.name;
      changed = true;
    }
  }

  const prof = profiles.find((p) => p.name === cleanText(next.aiName)) ?? null;

  if (!cleanText(next.enginePath)) {
    const first = filteredEngines[0] ?? engines[0] ?? null;
    if (first) {
      next.enginePath = first.path;
      changed = true;
    }
  }

  if (!cleanText(next.evalFilePath)) {
    const defEval = pickDefaultEvalFile(prof);
    const path = defEval ? defEval.path : "";
    if (next.evalFilePath !== path) {
      next.evalFilePath = path;
      changed = true;
    }
  }

  if (!next.bookEnabled) {
    if (next.bookFilePath !== null) {
      next.bookFilePath = null;
      changed = true;
    }
  } else if (!cleanText(next.bookFilePath ?? "")) {
    const defBook = pickDefaultBookDb(prof);
    const path = defBook ? defBook.path : null;
    if (next.bookFilePath !== path) {
      next.bookFilePath = path;
      changed = true;
    }
  }

  return changed ? next : cur;
}
