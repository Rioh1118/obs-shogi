import type {
  EngineCandidate,
  FileCandidate,
  ProfileCandidate,
} from "@/entities/engine/api/aiLibrary";
import type { EnginePreset } from "@/entities/engine-presets/model/types";
import { isSelectableEngine } from "@/features/settings/lib/presetEngineOptions";

export function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function parseIntSafe(v: string, fallback: number) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function pickDefaultEvalFile(profile: ProfileCandidate | null): FileCandidate | null {
  const xs = profile?.eval_files ?? [];
  if (xs.length === 0) return null;
  return xs.find((f) => f.entry === "nn.bin") ?? xs[0];
}

function pickDefaultBookDb(profile: ProfileCandidate | null): FileCandidate | null {
  const xs = profile?.book_db_files ?? [];
  if (xs.length === 0) return null;
  return xs[0];
}

/**
 * 空の欄だけを候補から埋める。1つも埋めなかったら同じ参照を返し、reducer は state を変えない。
 *
 * 定跡は「使う」ときだけ埋める。使わないときのパスを落とすのは保存。
 *
 * エンジンは選べる候補がちょうど1つのときだけ埋める。候補は名前で絞っていないので、
 * 2つ以上あるときの先頭は並びの都合でしかなく、利用者が選んでいないエンジンで保存される
 */
export function autofillPreset(
  cur: EnginePreset,
  candidates: {
    profiles: ProfileCandidate[];
    engines: EngineCandidate[];
  },
): EnginePreset {
  const { profiles, engines } = candidates;
  const next = { ...cur };
  let changed = false;

  if (!next.aiName.trim()) {
    const p = profiles.find((x) => x.has_eval_dir) ?? profiles[0] ?? null;
    if (p) {
      next.aiName = p.name;
      changed = true;
    }
  }

  const prof = profiles.find((p) => p.name === next.aiName.trim()) ?? null;

  if (!next.enginePath.trim()) {
    const selectable = engines.filter(isSelectableEngine);
    if (selectable.length === 1) {
      next.enginePath = selectable[0].path;
      changed = true;
    }
  }

  if (!next.evalFilePath.trim()) {
    const defEval = pickDefaultEvalFile(prof);
    const path = defEval ? defEval.path : "";
    if (next.evalFilePath !== path) {
      next.evalFilePath = path;
      changed = true;
    }
  }

  if (next.bookEnabled && !(next.bookFilePath ?? "").trim()) {
    const defBook = pickDefaultBookDb(prof);
    const path = defBook ? defBook.path : null;
    if (next.bookFilePath !== path) {
      next.bookFilePath = path;
      changed = true;
    }
  }

  return changed ? next : cur;
}
