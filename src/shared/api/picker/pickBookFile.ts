import { open as dialogOpen } from "@tauri-apps/plugin-dialog";

/**
 * 定跡ファイルを選ばせる。取り消したら `null`。
 *
 * **絞り込みは4拡張子。** 読めるのは `.db` だけだが、選べるようにしておく ——
 * 絞って隠すと、読めない形式を開こうとした人に「そのファイルは存在しない」に
 * 見えてしまい、**まだ読めないという事実が画面のどこにも出ない**。
 * 選んだ結果は `unsupported_format` として、何が読めるかを添えて返る。
 *
 * 出どころは `docs/PREMISES.md` P-006。**`.db.bin` という形式は存在しない。**
 */
export async function pickBookFile(): Promise<string | null> {
  const selected = await dialogOpen({
    directory: false,
    multiple: false,
    title: "定跡ファイルを選択してください",
    filters: [{ name: "定跡", extensions: ["db", "bin", "sbk", "ybb"] }],
  });

  if (!selected) return null;

  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}
