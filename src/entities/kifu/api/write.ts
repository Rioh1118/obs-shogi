import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { writeKifuToFile } from "./tauri";
import type { KifuFormat } from "../model/kifu";
import type { JKFData } from "../model/jkf";

/**
 * JKF を指定の形式でファイルへ書き出す
 *
 * throw しない。失敗はすべて `Err` に畳んであり、中身はそのまま利用者に見せられる
 * 日本語のメッセージ。呼び出し側で try/catch を重ねる必要はない。
 *
 * 書き出しは Rust 側で正規化を通るが、その結果は返さない。保存後の `jkf` は
 * ファイルの中身と一致するとは限らない。
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
