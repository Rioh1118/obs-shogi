import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuFormat } from "@/entities/kifu/model/kifu";

import { Normalizer } from "json-kifu-format";
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


/**
 * どの形式から読んでも表記が揃うようにする
 *
 * 「同」や相対表記は棋譜テキストに書かれていた分しか入らない。CSA には「同」の表記が
 * 無いため、これを通さないと同じ手が形式によって「☖２二銀」と「☖同　銀」に割れる。
 * 分岐を1つ追加すると applyMoveWithBranch が棋譜全体を正規化するので、
 * 通しておかないと「触っていない手の表記が勝手に変わる」ことになる。
 *
 * 非合法手を含む棋譜では正規化が throw する。そのときは元をそのまま返す。
 * 表記が揃わないだけで、開いて読むことはできる。
 */
function normalizeForDisplay(jkf: JKFData): JKFData {
  try {
    return Normalizer.normalizeMinimal(structuredClone(jkf));
  } catch {
    // 壊れかけの棋譜でも開けることを優先する
    return jkf;
  }
}

export function parseKifuContentToJKF(raw: string, format: KifuFormat): JKFData {
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
  return normalizeForDisplay(exportJKF(rec) as JKFData);
}

export function parseKifuStringToJKF(raw: string): ParsedKifu {
  const text = stripBom(raw).trim();
  if (!text) throw new KifuParseError("空の棋譜です。");

  if (text.startsWith("{") || text.startsWith("[")) {
    const rec = importJKFString(text);
    if (rec instanceof Error) throw new KifuParseError("JKF(JSON)の解析に失敗しました。", rec);
    return { detectedFormat: "jkf", jkf: normalizeForDisplay(exportJKF(rec) as JKFData) };
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

  if (rec instanceof Error) throw new KifuParseError("棋譜の解析に失敗しました。", rec);

  const detectedFormat: KifuFormat =
    fmt === RecordFormatType.CSA
      ? "csa"
      : fmt === RecordFormatType.KI2
        ? "ki2"
        : fmt === RecordFormatType.KIF
          ? "kif"
          : "jkf";

  return { detectedFormat, jkf: normalizeForDisplay(exportJKF(rec) as JKFData) };
}
