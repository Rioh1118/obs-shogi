import { backupBrokenConfig, loadConfig, saveConfig } from "./config";
import type { AppConfig, ChooseOpts } from "../model/types";
import { pickDirectory } from "@/shared/api/picker/pickDirectory";

/**
 * 既存の設定と、それを読めたかどうか。
 *
 * ここは root を**決める**側で、決め直す唯一の出口でもある。読めない設定に
 * 依存すると、`app.json` が壊れているときに出口そのものが同じ理由で落ちる。
 *
 * **読めなかったことを値に潰さない。** `save_config` はファイルごと置き換えるので、
 * 空として扱ったまま書くと、読めていない欄（`ai_root` / `last_preset_id`）が
 * `null` で書き潰される。AI フォルダを選び直しただけでワークスペースが消える、
 * という形で次の起動に出る
 */
async function currentConfig(): Promise<{ config: AppConfig; loaded: boolean }> {
  try {
    return { config: await loadConfig(), loaded: true };
  } catch {
    return { config: { root_dir: null, ai_root: null }, loaded: false };
  }
}

/**
 * 読めなかった設定を退避してから書く。
 *
 * 退避に失敗しても書き込みは続ける（出口を塞がないことが優先）。
 * 退避できたかどうかは呼び出し元へは返さない → TODO(#255)
 */
async function saveOver(config: AppConfig, loaded: boolean): Promise<void> {
  if (!loaded) {
    try {
      await backupBrokenConfig();
    } catch {
      // 退避できなくても、選び直せることのほうが大事
    }
  }
  await saveConfig(config);
}

function ensureNonEmpty(label: string, value: string | null): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`不正な${label}です`);
  }
  return value;
}

export async function chooseRootDir(opts: ChooseOpts = {}): Promise<string | null> {
  const { force = false } = opts;
  const { config, loaded } = await currentConfig();

  if (!force && config.root_dir) return config.root_dir;

  const picked = await pickDirectory("ルートディレクトリを選択してください");
  if (!picked) return null;

  const rootDir = ensureNonEmpty("ルートディレクトリ", picked);
  await saveOver({ ...config, root_dir: rootDir }, loaded);
  return rootDir;
}

export async function chooseAiRoot(opts: ChooseOpts = {}): Promise<string | null> {
  const { force = false } = opts;
  const { config, loaded } = await currentConfig();

  if (!force && config.ai_root) return config.ai_root;

  const picked = await pickDirectory("AIのルートディレクトリを選択してください");
  if (!picked) return null;

  const aiRoot = ensureNonEmpty("AI_ROOT", picked);
  await saveOver({ ...config, ai_root: aiRoot }, loaded);
  return aiRoot;
}

export async function setRootDir(root_dir: string): Promise<void> {
  const { config, loaded } = await currentConfig();
  const next = ensureNonEmpty("ルートディレクトリ", root_dir);
  await saveOver({ ...config, root_dir: next }, loaded);
}
