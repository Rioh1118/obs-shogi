import type { KifuFormat, AsyncResult, JKFData } from "@/types";

export interface KifuLoader {
  // 棋譜ファイル内容をJKFに正規化
  parseKifuContent(
    content: string,
    format: KifuFormat,
  ): AsyncResult<JKFData, string>;
}
