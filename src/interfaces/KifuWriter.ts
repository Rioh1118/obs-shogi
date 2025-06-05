import type { JKFData, AsyncResult, KifuFormat } from "@/types";

export interface KifuWriter {
  // JKFデータをファイルに書き込み
  writeToFile(
    jkf: JKFData,
    filePath: string,
    format: KifuFormat,
  ): AsyncResult<void, string>;
}
