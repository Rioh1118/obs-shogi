import { open as dialogOpen, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";

/** 1つだけ選ばせるダイアログを開き、選ばれたパスを返す。取り消したら `null` */
export async function openSinglePath(
  options: Omit<OpenDialogOptions, "multiple">,
): Promise<string | null> {
  const selected: string | string[] | null = await dialogOpen({ ...options, multiple: false });
  if (!selected) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}
