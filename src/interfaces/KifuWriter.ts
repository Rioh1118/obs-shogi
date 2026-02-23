import type { JKFData, KifuFormat } from "@/entities/kifu";
import type { AsyncResult } from "@/shared/lib/result";

export interface KifuWriter {
  // JKFデータをファイルに書き込み
  writeToFile(
    jkf: JKFData,
    filePath: string,
    format: KifuFormat,
  ): AsyncResult<void, string>;
}
