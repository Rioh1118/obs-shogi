import { Ok, Err, type AsyncResult } from "@/types";
import type { KifuWriter as IKifuWriter } from "@/interfaces";
import type { JKFData, KifuFormat } from "@/types";
import { writeKifuToFile } from "@/commands/kifuWriter";

export class KifuWriterImpl implements IKifuWriter {
  /**
   * JKFデータをファイルに書き込み
   */
  async writeToFile(
    jkf: JKFData,
    filePath: string,
    format: KifuFormat,
  ): AsyncResult<void, string> {
    try {
      const response = await writeKifuToFile(jkf, filePath, format);

      if (!response.success) {
        return Err(response.error || "ファイル書き込みに失敗しました");
      }

      return Ok(undefined);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "ファイル書き込みに失敗しました";

      return Err(errorMessage);
    }
  }
}

export class KifuWriterFactory {
  static createInstance(): IKifuWriter {
    return new KifuWriterImpl();
  }
}
