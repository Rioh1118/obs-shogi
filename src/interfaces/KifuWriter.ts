import type { JKFData, AsyncResult, KifuFormat } from "@/types";

export interface KifuWriter {
  // JKFデータを指定形式の文字列に変換
  convertToString(
    jkf: JKFData,
    format: KifuFormat,
  ): AsyncResult<string, string>;

  // JKFデータをファイルに書き込み
  writeToFile(
    jkf: JKFData,
    filePath: string,
    format: KifuFormat,
  ): AsyncResult<void, string>;
}
