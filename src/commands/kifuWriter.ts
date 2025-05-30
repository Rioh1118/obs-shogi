import { invoke } from "@tauri-apps/api/core";
import type { JKFFormat } from "@/types/kifu";

export type KifuFormat = "kif" | "ki2" | "csa" | "jkf" | "json";

interface WriteKifuRequest {
  jkf: JKFFormat;
  file_path: string;
  format: string;
}

interface WriteKifuResponse {
  success: boolean;
  file_path?: string;
  normalized_jkf?: JKFFormat;
  error?: string;
}

interface ConvertKifuRequest {
  jkf: JKFFormat;
  format: string;
}

interface ConvertKifuResponse {
  success: boolean;
  content?: string;
  normalized_jkf?: JKFFormat;
  error?: string;
}

export interface WriteKifuResult {
  filePath: string;
  normalized_jkf: JKFFormat;
}

export interface ConvertKifuResult {
  content: string;
  normalizedJkf: JKFFormat;
}

/**
 * 棋譜ファイル書き込み関連のコマンド
 */
export class KifuWriter {
  /**
   * JKFデータを指定された形式でファイルに書き込む
   * @param jkf JKFデータ
   * @param filePath 保存先ファイルパス
   * @param format 出力形式
   * @returns 書き込み結果と正規化されたJKFデータ
   */
  static async writeToFile(
    jkf: JKFFormat,
    filePath: string,
    format: KifuFormat,
  ): Promise<WriteKifuResult> {
    const request: WriteKifuRequest = {
      jkf,
      file_path: filePath,
      format,
    };

    const response: WriteKifuResponse = await invoke("write_kifu_to_file", {
      request,
    });

    if (!response.success) {
      throw new Error(response.error || "ファイル書き込みに失敗しました");
    }

    return {
      filePath: response.file_path!,
      normalizedJkf: response.normalized_jkf!,
    };
  }

  /**
   * JKFデータを指定された形式の文字列に変換
   * @param jkf JKFデータ
   * @param format 出力形式
   * @returns 変換結果と正規化されたJKFデータ
   */
  static async convertToString(
    jkf: JKFFormat,
    format: KifuFormat,
  ): Promise<ConvertKifuResult> {
    const request: ConvertKifuRequest = {
      jkf,
      format,
    };

    const response: ConvertKifuResponse = await invoke(
      "convert_jkf_to_format",
      {
        request,
      },
    );

    if (!response.success) {
      throw new Error(response.error || "変換に失敗しました");
    }

    return {
      content: response.content!,
      normalizedJkf: response.normalized_jkf!,
    };
  }

  /**
   * JKFデータを正規化する
   * @param jkf JKFデータ
   * @returns 正規化されたJKFデータ
   */
  static async normalize(jkf: JKFFormat): Promise<JKFFormat> {
    const response: ConvertKifuResponse = await invoke("normalize_jkf", {
      jkf,
    });

    if (!response.success) {
      throw new Error(response.error || "正規化に失敗しました");
    }

    return response.normalized_jkf!;
  }

  /**
   * ファイル拡張子から形式を推定
   * @param filePath ファイルパス
   * @returns 推定された形式
   */
  static getFormatFromPath(filePath: string): KifuFormat {
    const extension = filePath.split(".").pop()?.toLowerCase();

    switch (extension) {
      case "kif":
        return "kif";
      case "ki2":
        return "ki2";
      case "csa":
        return "csa";
      case "jkf":
      case "json":
        return "jkf";
      default:
        return "kif"; // デフォルト
    }
  }

  /**
   * 形式に応じた適切な拡張子を取得
   * @param format 形式
   * @returns 拡張子
   */
  static getExtension(format: KifuFormat): string {
    switch (format) {
      case "kif":
        return "kif";
      case "ki2":
        return "ki2";
      case "csa":
        return "csa";
      case "jkf":
      case "json":
        return "jkf";
      default:
        return "kif";
    }
  }

  /**
   * ファイルパスに適切な拡張子を付与
   * @param filePath 元のファイルパス
   * @param format 形式
   * @returns 拡張子が付与されたファイルパス
   */
  static ensureExtension(filePath: string, format: KifuFormat): string {
    const expectedExtension = this.getExtension(format);
    const currentExtension = filePath.split(".").pop()?.toLowerCase();

    if (currentExtension !== expectedExtension) {
      // 既存の拡張子を削除して新しい拡張子を追加
      const pathWithoutExtension = filePath.replace(/\.[^/.]+$/, "");
      return `${pathWithoutExtension}.${expectedExtension}`;
    }

    return filePath;
  }

  /**
   * 形式の表示名を取得
   * @param format 形式
   * @returns 表示名
   */
  static getFormatDisplayName(format: KifuFormat): string {
    switch (format) {
      case "kif":
        return "KIF形式";
      case "ki2":
        return "KI2形式";
      case "csa":
        return "CSA形式";
      case "jkf":
      case "json":
        return "JSON棋譜形式";
      default:
        return "不明な形式";
    }
  }

  /**
   * サポートされている形式の一覧を取得
   * @returns サポートされている形式の配列
   */
  static getSupportedFormats(): Array<{
    value: KifuFormat;
    label: string;
    extension: string;
  }> {
    return [
      {
        value: "kif",
        label: "KIF形式",
        extension: "kif",
      },
      {
        value: "ki2",
        label: "KI2形式",
        extension: "ki2",
      },
      {
        value: "csa",
        label: "CSA形式",
        extension: "csa",
      },
      {
        value: "jkf",
        label: "JSON棋譜形式",
        extension: "jkf",
      },
    ];
  }
}

/**
 * 棋譜書き込みのヘルパー関数
 */
export const kifuWriterHelpers = {
  /**
   * 安全にファイルに書き込む（エラーハンドリング付き）
   */
  async safeWriteToFile(
    jkf: JKFFormat,
    filePath: string,
    format: KifuFormat,
    onSuccess?: (result: WriteKifuResult) => void,
    onError?: (error: string) => void,
  ): Promise<WriteKifuResult | null> {
    try {
      const result = await KifuWriter.writeToFile(jkf, filePath, format);
      onSuccess?.(result);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "不明なエラー";
      onError?.(errorMessage);
      return null;
    }
  },

  /**
   * 安全に文字列に変換する（エラーハンドリング付き）
   */
  async safeConvertToString(
    jkf: JKFFormat,
    format: KifuFormat,
    onSuccess?: (result: ConvertKifuResult) => void,
    onError?: (error: string) => void,
  ): Promise<ConvertKifuResult | null> {
    try {
      const result = await KifuWriter.convertToString(jkf, format);
      onSuccess?.(result);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "不明なエラー";
      onError?.(errorMessage);
      return null;
    }
  },

  /**
   * 安全に正規化する（エラーハンドリング付き）
   */
  async safeNormalize(
    jkf: JKFFormat,
    onSuccess?: (result: JKFFormat) => void,
    onError?: (error: string) => void,
  ): Promise<JKFFormat | null> {
    try {
      const result = await KifuWriter.normalize(jkf);
      onSuccess?.(result);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "不明なエラー";
      onError?.(errorMessage);
      return null;
    }
  },
};

export default KifuWriter;
