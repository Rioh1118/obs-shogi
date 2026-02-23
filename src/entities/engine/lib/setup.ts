import type { EngineInfo, EngineSettings } from "../api/rust-types";
import {
  applyEngineSettings,
  getEngineInfo,
  initializeEngine,
} from "../api/tauri";
import type { EngineRuntimeConfig } from "../model/types";

export async function setupYaneuraOuEngine(
  config: EngineRuntimeConfig,
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
