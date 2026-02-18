import type { EngineInfo, EngineSettings } from "./types";
import { initializeEngine, getEngineInfo, applyEngineSettings } from "./core";

export type SetupEngineArgs = {
  enginePath: string;
  workDir: string;
  evalDir: string;
  bookDir: string | null;
  bookFile: string | null;
  options: Record<string, string>;
};

export async function setupYaneuraOuEngine(
  config: SetupEngineArgs,
): Promise<EngineInfo> {
  // 起動
  await initializeEngine(config.enginePath, config.workDir);

  // setoption群
  const settings: EngineSettings = {
    options: {
      ...config.options,
      EvalDir: config.evalDir,
      ...(config.bookDir ? { BookDir: config.bookDir } : {}),
      ...(config.bookFile ? { BookFile: config.bookFile } : {}),
    },
  };
  await applyEngineSettings(settings);

  // info取得
  const info = await getEngineInfo();
  if (!info) throw new Error("Failed to get engine info");

  return info;
}
