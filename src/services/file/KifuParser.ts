import type { KifuFormat, AsyncResult, JKFData } from "@/types";
import type { KifuLoader } from "@/interfaces";
import { Parsers } from "json-kifu-format";
import { preprocessText } from "@/utils/textUtils";

/**
 * 棋譜ファイルの内容を解析してJKF形式に変換するパーサー
 */
export class KifuParser implements KifuLoader {
  async parseKifuContent(
    content: string,
    format: KifuFormat,
  ): AsyncResult<JKFData, string> {
    try {
      const processedContent = preprocessText(content);
      let jkfData: JKFData;
      switch (format) {
        case "kif":
          jkfData = Parsers.parseKIF(processedContent);
          break;
        case "ki2":
          jkfData = Parsers.parseKI2(processedContent);
          break;
        case "csa":
          jkfData = Parsers.parseCSA(processedContent);
          break;
        case "jkf":
          jkfData = JSON.parse(processedContent) as JKFData;
          break;
        default:
          return {
            success: false,
            error: `サポートされていない形式です: ${format}`,
          };
      }

      return { success: true, data: jkfData };
    } catch (error) {
      console.error("棋譜変換エラー", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? `棋譜変換に失敗しました: ${error.message}`
            : `棋譜変換に失敗しました: ${String(error)}`,
      };
    }
  }
}

/**
 * KifuParserのインスタンス生成を担当するファクトリ
 */
export class KifuParserFactory {
  private static instance: KifuLoader | null = null;

  /**
   * シングルトンパターンでKifuParserのインスタンスを取得
   */
  static getInstance(): KifuLoader {
    if (!this.instance) {
      this.instance = new KifuParser();
    }
    return this.instance;
  }

  /**
   * 新しいKifuParserインスタンスを作成
   */
  static createNew(): KifuLoader {
    return new KifuParser();
  }
}
