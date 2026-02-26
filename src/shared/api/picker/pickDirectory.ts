import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

export async function pickDirectory(title: string): Promise<string | null> {
  const selected = await dialogOpen({
    directory: true,
    multiple: false,
    title,
  });

  if (!selected) return null;

  const dir = Array.isArray(selected) ? selected[0] : selected;
  return dir ?? null;
}
