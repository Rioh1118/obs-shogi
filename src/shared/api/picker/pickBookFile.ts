import { openSinglePath } from "./openSinglePath";

/**
 * 定跡ファイルを選ばせる。取り消したら `null`。
 *
 * 絞り込みは4拡張子にする。読めるのは `.db` だけだが、絞って隠すと読めない形式が「存在しない」に見え、
 * **まだ読めないという事実が画面に出ない**。選んだ結果は `unsupported_format` として、何が読めるかを添えて返る。
 *
 * 出どころは `docs/PREMISES.md` P-006。`.db.bin` という形式は存在しない。
 */
export async function pickBookFile(): Promise<string | null> {
  return openSinglePath({
    directory: false,
    title: "定跡ファイルを選択してください",
    filters: [{ name: "定跡", extensions: ["db", "bin", "sbk", "ybb"] }],
  });
}
