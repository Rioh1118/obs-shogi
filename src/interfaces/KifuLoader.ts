import type { AsyncResult, JKFData, KifuFileInfo } from "@/types";

export interface KifuFile {
  name: string;
  path: string;
  format: KifuFormat;
  size: number;
  lastModified: Date;
}

export type KifuFormat = "";

export interface KifuLoader {
  // 棋譜ファイル内容をJKFに正規化
  parseKifuContent(
    content: string,
    format: KifuFormat,
  ): AsyncResult<JKFData, string>;

  // 棋譜メタデータを抽出
  extractKifuMetadata(jkf: JKFData): AsyncResult<KifuFileInfo, string>;

  // JKFデータを正規化
  normalize(jkf: JKFData): AsyncResult<JKFData, string>;
}
