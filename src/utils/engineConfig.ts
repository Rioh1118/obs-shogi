import type { EngineConfig } from "@/types/engine";

export function isConfigured(cfg: EngineConfig): boolean {
  return Boolean(cfg.aiRoot && cfg.selectedAiName && cfg.selectedEngineRel);
}

export function deepEqualConfig(a: EngineConfig, b: EngineConfig): boolean {
  if (a.aiRoot !== b.aiRoot) return false;
  if (a.selectedAiName !== b.selectedAiName) return false;
  if (a.selectedEngineRel !== b.selectedEngineRel) return false;

  if (a.evalDirName !== b.evalDirName) return false;
  if (a.bookDirName !== b.bookDirName) return false;
  if (a.bookFileName !== b.bookFileName) return false;

  const ak = Object.keys(a.options);
  const bk = Object.keys(b.options);
  if (ak.length !== bk.length) return false;

  for (const k of ak) {
    if (a.options[k] !== b.options[k]) return false;
  }
  return true;
}

export function resolvePaths(cfg: EngineConfig) {
  if (!cfg.aiRoot || !cfg.selectedAiName || !cfg.selectedEngineRel) return null;

  const enginePath = `${cfg.aiRoot}/engines/${cfg.selectedEngineRel}`;
  const workDir = `${cfg.aiRoot}/${cfg.selectedAiName}`;

  // workDirからの相対として setoption に渡す前提
  const evalDir = cfg.evalDirName; // "eval"
  const bookDir = cfg.bookDirName; // "book"
  const bookFile = cfg.bookFileName; // "user_book1.db"

  return { enginePath, workDir, evalDir, bookDir, bookFile };
}
