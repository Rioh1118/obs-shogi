import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

/** ファイルを1つ選ばせる。取り消したら `null`。絞り込みはしない（何を読むかは呼び手が決める） */
export async function pickFile(title: string): Promise<string | null> {
  const selected = await dialogOpen({ directory: false, multiple: false, title });
  if (!selected) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}
