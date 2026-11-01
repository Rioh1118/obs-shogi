import { backupBrokenConfig, loadConfig, saveConfig } from "./config";
import type { AppConfig, ChooseOpts } from "../model/types";
import { pickDirectory } from "@/shared/api/picker/pickDirectory";

/**
 * 既存の設定と、それを読めたかどうかを返す。読めなくても投げない。
 *
 * ここは root を決める側で、`app.json` が壊れたときに決め直す経路でもある。
 * 投げると、起動エラーの画面の `ChooseWorkspaceButton` が同じ理由で落ちる。
 *
 * 読めなかったことを値に潰さない。`save_config` はファイルごと置き換えるので、
 * 空として扱ったまま書くと、読めていない欄が `null` で書き潰される。
 * AI ライブラリを選び直しただけでワークスペースが消える、という形で次の起動に出る
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
 * 退避に失敗しても書き込みは続ける。場所を選び直せることを優先する。
 *
 * TODO(#277): 退避できたかどうかを呼び手へ返す
 */
async function saveOver(config: AppConfig, loaded: boolean): Promise<void> {
  if (!loaded) {
    try {
      await backupBrokenConfig();
    } catch {
      // 書き込みは続ける
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

type DirectoryField = "root_dir" | "ai_root";

/**
 * 欄の場所を決める。`force` でなければ、決まっている値をピッカーなしで返す。
 *
 * 取り消しは `null` で、設定は書かない。
 */
async function chooseDirectory(
  field: DirectoryField,
  label: string,
  { force = false }: ChooseOpts,
): Promise<string | null> {
  const { config, loaded } = await currentConfig();

  const current = config[field];
  if (!force && current) return current;

  const picked = await pickDirectory(`${label}を選択してください`);
  if (!picked) return null;

  const directory = ensureNonEmpty(label, picked);
  await saveOver({ ...config, [field]: directory }, loaded);
  return directory;
}

export function chooseRootDir(opts: ChooseOpts = {}): Promise<string | null> {
  return chooseDirectory("root_dir", "ワークスペース", opts);
}

export function chooseAiRoot(opts: ChooseOpts = {}): Promise<string | null> {
  return chooseDirectory("ai_root", "AI ライブラリ", opts);
}

export async function setRootDir(rootDir: string): Promise<void> {
  const { config, loaded } = await currentConfig();
  const next = ensureNonEmpty("ワークスペース", rootDir);
  await saveOver({ ...config, root_dir: next }, loaded);
}
