// utils/kifuParseUtils.ts
import type { IJSONKifuFormat } from "json-kifu-format/dist/src/Formats";
import type { KifuFormat } from "@/types";

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
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "KifuParseError";
    this.cause = cause;
  }
}

export type ParsedKifu = {
  detectedFormat: KifuFormat;
  jkf: IJSONKifuFormat;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

function toIJsonKifuFormat(jkf: unknown): IJSONKifuFormat {
  // tsshogiのJKFと json-kifu-format の IJSONKifuFormat は構造がほぼ同じなのでキャストでOK
  return jkf as unknown as IJSONKifuFormat;
}

export function parseKifuStringToJKF(raw: string): ParsedKifu {
  const text = stripBom(raw).trim();
  if (!text) throw new KifuParseError("空の棋譜です。");

  // 1) JSON(JKF)っぽいなら、まず tsshogi の importJKFString を使う（= JSON parse + 検証）
  if (text.startsWith("{") || text.startsWith("[")) {
    const rec = importJKFString(text);
    if (rec instanceof Error) {
      throw new KifuParseError("JKF(JSON)の解析に失敗しました。", rec);
    }
    const jkf = exportJKF(rec);
    return { detectedFormat: "jkf", jkf: toIJsonKifuFormat(jkf) };
  }

  // 2) 非JSONは detect して import
  let fmt: RecordFormatType;
  try {
    fmt = detectRecordFormat(text);
  } catch (e) {
    throw new KifuParseError("棋譜形式の判定に失敗しました。", e);
  }

  const rec =
    fmt === RecordFormatType.CSA
      ? importCSA(text)
      : fmt === RecordFormatType.KI2
        ? importKI2(text)
        : fmt === RecordFormatType.KIF
          ? importKIF(text)
          : // tsshogi が JKF と判定する可能性もあるので一応
            fmt === RecordFormatType.JKF
            ? importJKFString(text)
            : new Error(`未対応形式: ${String(fmt)}`);

  if (rec instanceof Error) {
    throw new KifuParseError("棋譜の解析に失敗しました。", rec);
  }

  const jkf = exportJKF(rec);

  // detectedFormat を KifuFormat に寄せる
  const detectedFormat: KifuFormat =
    fmt === RecordFormatType.CSA
      ? "csa"
      : fmt === RecordFormatType.KI2
        ? "ki2"
        : fmt === RecordFormatType.KIF
          ? "kif"
          : "jkf";

  return { detectedFormat, jkf: toIJsonKifuFormat(jkf) };
}
