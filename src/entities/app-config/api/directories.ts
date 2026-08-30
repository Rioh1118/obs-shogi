import { loadConfig, saveConfig } from "./config";
import type { AppConfig, ChooseOpts } from "../model/types";
import { pickDirectory } from "@/shared/api/picker/pickDirectory";

/**
 * 既存の設定。**読めなければ空として扱う。**
 *
 * ここは root を**決める**側で、決め直す唯一の出口でもある。読めない設定に
 * 依存すると、`app.json` が壊れているときに出口そのものが同じ理由で落ちる。
 * 実際、起動エラーの画面で押せる唯一のボタンが、ピッカーを開く前に落ちていた
 */
async function currentConfig(): Promise<AppConfig> {
  try {
    return await loadConfig();
  } catch {
    return { root_dir: null, ai_root: null };
  }
}

function ensureNonEmpty(label: string, value: string | null): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`不正な${label}です`);
  }
  return value;
}

export async function chooseRootDir(opts: ChooseOpts = {}): Promise<string | null> {
  const { force = false } = opts;
  const config = await currentConfig();

  if (!force && config.root_dir) return config.root_dir;

  const picked = await pickDirectory("ルートディレクトリを選択してください");
  if (!picked) return null;

  const rootDir = ensureNonEmpty("ルートディレクトリ", picked);
  await saveConfig({ ...config, root_dir: rootDir });
  return rootDir;
}

export async function chooseAiRoot(opts: ChooseOpts = {}): Promise<string | null> {
  const { force = false } = opts;
  const config = await currentConfig();

  if (!force && config.ai_root) return config.ai_root;

  const picked = await pickDirectory("AIのルートディレクトリを選択してください");
  if (!picked) return null;

  const aiRoot = ensureNonEmpty("AI_ROOT", picked);
  await saveConfig({ ...config, ai_root: aiRoot });
  return aiRoot;
}

export async function setRootDir(root_dir: string): Promise<void> {
  const config = await loadConfig();
  const next = ensureNonEmpty("ルートディレクトリ", root_dir);
  await saveConfig({ ...config, root_dir: next });
}
