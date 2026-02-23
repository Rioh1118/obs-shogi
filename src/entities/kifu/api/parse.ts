import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuFormat } from "@/entities/kifu/model/kifu";

import {
  detectRecordFormat,
  RecordFormatType,
  importKIF,
  importKI2,
  importCSA,
  importJKFString,
  exportJKF,
} from "tsshogi";

export class KifuParseError extends Error {
  readonly cause?: Error | string;
  constructor(message: string, cause?: Error | string) {
    super(message);
    this.name = "KifuParseError";
    this.cause = cause;
  }
}

export type ParsedKifu = {
  detectedFormat: KifuFormat;
  jkf: JKFData;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

export function parseKifuContentToJKF(
  raw: string,
  format: KifuFormat,
): JKFData {
  const text = stripBom(raw).trim();
  if (!text) throw new KifuParseError("空の棋譜です。");

  const rec =
    format === "csa"
      ? importCSA(text)
      : format === "ki2"
        ? importKI2(text)
        : format === "kif"
          ? importKIF(text)
          : importJKFString(text);

  if (rec instanceof Error) {
    throw new KifuParseError(`棋譜(${format})の解析に失敗しました。`, rec);
  }
  return exportJKF(rec) as JKFData;
}

export function parseKifuStringToJKF(raw: string): ParsedKifu {
  const text = stripBom(raw).trim();
  if (!text) throw new KifuParseError("空の棋譜です。");

  if (text.startsWith("{") || text.startsWith("[")) {
    const rec = importJKFString(text);
    if (rec instanceof Error)
      throw new KifuParseError("JKF(JSON)の解析に失敗しました。", rec);
    return { detectedFormat: "jkf", jkf: exportJKF(rec) as JKFData };
  }

  let fmt: RecordFormatType;
  try {
    fmt = detectRecordFormat(text);
  } catch (e) {
    throw new KifuParseError(
      "棋譜形式の判定に失敗しました。",
      e instanceof Error ? e.message : String(e),
    );
  }

  const rec =
    fmt === RecordFormatType.CSA
      ? importCSA(text)
      : fmt === RecordFormatType.KI2
        ? importKI2(text)
        : fmt === RecordFormatType.KIF
          ? importKIF(text)
          : importJKFString(text);

  if (rec instanceof Error)
    throw new KifuParseError("棋譜の解析に失敗しました。", rec);

  const detectedFormat: KifuFormat =
    fmt === RecordFormatType.CSA
      ? "csa"
      : fmt === RecordFormatType.KI2
        ? "ki2"
        : fmt === RecordFormatType.KIF
          ? "kif"
          : "jkf";

  return { detectedFormat, jkf: exportJKF(rec) as JKFData };
}
