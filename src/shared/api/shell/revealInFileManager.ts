import { openPath } from "@tauri-apps/plugin-opener";

export async function revealInFileManager(path: string): Promise<void> {
  const p = (path ?? "").trim();
  if (!p) return;

  try {
    await openPath(p);
  } catch (e) {
    console.error("finder 開けない", e);
  }
}
