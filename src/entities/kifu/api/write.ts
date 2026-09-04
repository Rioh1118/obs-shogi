import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { writeKifuToFile } from "./tauri";
import type { KifuFormat } from "../model/kifu";
import type { JKFData } from "../model/jkf";

/**
 * JKF を指定の形式でファイルへ書き出す
 *
 * throw しない。失敗はすべて `Err` に畳むので、呼び出し側で try/catch を重ねる必要はない。
 * ただし中身は日本語とは限らない。Rust の `atomic_write` が返す OS のエラー
 * （`Permission denied (os error 13)` など）がそのまま入るので、
 * 利用者に出すなら何をしようとして失敗したのかを前後に足すこと。
 *
 * この関数が呼ぶ `write_kifu_to_file` は正規化しない（`src-tauri/src/kifu.rs`）。
 * 一方、新規作成の `create_kifu_file` は書く前に Rust 側で正規化する
 * （`src-tauri/src/workspace/commands/kifu.rs`）。同じ JKF でも、作った時と
 * 保存し直した時でファイルの中身が揃わない。
 *
 * KIF / KI2 / CSA への変換は非可逆なので、いずれにせよ書いたファイルを読み直した JKF は
 * 渡した `jkf` と一致するとは限らない。
 */
export async function saveKifuToFile(
  jkf: JKFData,
  filePath: string,
  format: KifuFormat,
): AsyncResult<void, string> {
  try {
    const res = await writeKifuToFile(jkf, filePath, format);
    if (!res.success) {
      return Err(res.error || "ファイル書き込みに失敗しました");
    }
    return Ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Err(msg || "ファイル書き込みに失敗しました");
  }
}
