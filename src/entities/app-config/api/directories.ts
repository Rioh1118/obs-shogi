import type { ChooseOpts } from "@/commands/config_dir";
import { open } from "@tauri-apps/plugin-dialog";
import { loadConfig, saveConfig } from "./config";

async function pickDirectory(title: string): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  if (!selected) return null;
  const dir = Array.isArray(selected) ? selected[0] : selected;
  return dir ?? null;
}

function ensureNonEmpty(label: string, value: string | null): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`不正な${label}です`);
  }
  return value;
}

export async function chooseRootDir(
  opts: ChooseOpts = {},
): Promise<string | null> {
  const { force = false } = opts;
  const config = await loadConfig();

  if (!force && config.root_dir) return config.root_dir;

  const picked = await pickDirectory("ルートディレクトリを選択してください");
  if (!picked) return null;

  const rootDir = ensureNonEmpty("ルートディレクトリ", picked);
  await saveConfig({ ...config, root_dir: rootDir });
  return rootDir;
}

export async function chooseAiRoot(
  opts: ChooseOpts = {},
): Promise<string | null> {
  const { force = false } = opts;
  const config = await loadConfig();

  if (!force && config.ai_root) return config.ai_root;

  const picked = await pickDirectory(
    "AIのルートディレクトリを選択してください",
  );
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
