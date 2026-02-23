import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { writeKifuToFile } from "./tauri";
import type { KifuFormat } from "../model/kifu";
import type { JKFData } from "../model/jkf";

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
