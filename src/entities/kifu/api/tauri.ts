import { invoke } from "@tauri-apps/api/core";
import type { JKFData } from "../model/jkf";
import type { KifuFormat } from "../model/kifu";

interface WriteKifuRequest {
  jkf: JKFData;
  file_path: string;
  format: string;
}

interface WriteKifuResponse {
  success: boolean;
  file_path?: string;
  normalized_jkf?: JKFData;
  error?: string;
}

interface ConvertKifuRequest {
  jkf: JKFData;
  format: string;
}

interface ConvertKifuResponse {
  success: boolean;
  content?: string;
  normalized_jkf?: JKFData;
  error?: string;
}

/**
 * JKFデータを指定された形式でファイルに書き込む
 */
export async function writeKifuToFile(
  jkf: JKFData,
  filePath: string,
  format: KifuFormat,
): Promise<WriteKifuResponse> {
  const request: WriteKifuRequest = {
    jkf,
    file_path: filePath,
    format,
  };

  return await invoke("write_kifu_to_file", { request });
}

/**
 * JKFデータを指定された形式の文字列に変換
 */
export async function convertJkfToFormat(
  jkf: JKFData,
  format: KifuFormat,
): Promise<ConvertKifuResponse> {
  const request: ConvertKifuRequest = {
    jkf,
    format,
  };

  return await invoke("convert_jkf_to_format", { request });
}

/**
 * JKFデータを正規化する
 */
export async function normalizeJkf(jkf: JKFData): Promise<ConvertKifuResponse> {
  return await invoke("normalize_jkf", { jkf });
}
