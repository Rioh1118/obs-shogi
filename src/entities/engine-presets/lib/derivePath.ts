import { join } from "pathe";
import type { EnginePreset } from "../model/types";
import { getParentPath } from "@/utils/path";

type DerivedPaths = {
  engineDir: string;
  evalDir: string;
  bookDir: string | null;

  // 解析用workDir (ai_root/<ai_name>)
  workDir: string;
};

export function derivePaths(
  preset: EnginePreset,
  aiRoot: string,
): DerivedPaths {
  const engineDir = getParentPath(preset.enginePath);
  const evalDir = getParentPath(preset.evalFilePath);
  const bookDir =
    preset.bookEnabled && preset.bookFilePath
      ? getParentPath(preset.bookFilePath)
      : null;

  const workDir = join(aiRoot, preset.aiName);

  return { engineDir, evalDir, bookDir, workDir };
}
