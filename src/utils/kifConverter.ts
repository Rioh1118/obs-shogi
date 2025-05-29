import type { KifuFormat, JKFFormat } from "@/types/kifu";
import { Parsers } from "json-kifu-format";
import { preprocessText } from "./textUtils";

export async function convertToJkf(
  content: string,
  format: KifuFormat,
): Promise<JKFFormat> {
  try {
    content = preprocessText(content);

    switch (format) {
      case "kif":
        return Parsers.parseKIF(content);

      case "ki2":
        return Parsers.parseKI2(content);

      case "csa":
        return Parsers.parseCSA(content);

      case "jkf":
        return JSON.parse(content) as JKFFormat;

      case "unknown":
      default:
        throw new Error(`サポートされていない形式です: ${format}`);
    }
  } catch (err) {
    console.error("棋譜変換エラー", err);
    throw new Error(`棋譜変換に失敗しました: ${err}`);
  }
}
