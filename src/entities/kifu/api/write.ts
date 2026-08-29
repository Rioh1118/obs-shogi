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
 * 書き出しに正規化は挟まらない。Rust 側で `normalize()` を呼ぶのは
 * `convert_jkf_to_format` と `normalize_jkf` だけで、この経路は通らない。
 * KIF / KI2 / CSA への変換は非可逆なので、書いたファイルを読み直した JKF は
 * 渡した `jkf` と一致しない。
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
