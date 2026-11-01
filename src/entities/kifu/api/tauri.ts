import { invoke } from "@tauri-apps/api/core";
import type { JKFData } from "../model/jkf";
import type { KifuFormat } from "../model/kifu";

type WriteKifuRequest = {
  jkf: JKFData;
  file_path: string;
  format: string;
};

type WriteKifuResponse = {
  success: boolean;
  file_path?: string;
  normalized_jkf?: JKFData;
  error?: string;
};

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
