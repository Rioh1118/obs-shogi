import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuFormat } from "@/entities/kifu/model/kifu";
import { sanitizeJkf } from "@/entities/kifu/lib/sanitizeJkf";
import { cloneJkf } from "@/entities/kifu/lib/cloneJkf";

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

/**
 * 棋譜を `JKFData` にできなかったことを表す
 *
 * `message` はそのまま利用者に見せる想定で日本語で書く。`cause` には tsshogi や
 * 形式判定が返した理由が入るが、こちらは利用者向けではない。
 */
export class KifuParseError extends Error {
  readonly cause?: Error | string;
  constructor(message: string, cause?: Error | string) {
    super(message);
    this.name = "KifuParseError";
    this.cause = cause;
  }
}

export type ParsedKifu = {
  /**
   * 中身から判定した形式。
   *
   * 拡張子ではなくテキストから決めているので、保存し直すときはこれに合わせないと
   * 中身と拡張子が食い違う。
   */
  detectedFormat: KifuFormat;
  jkf: JKFData;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/**
 * どの形式から読んでも表記が揃うようにする
 *
 * 戻り値は表示だけでなく保存にも使われる正規形。ここで足した `same` / `relative` は
 * 書き戻したファイルにも出る。
 *
 * 「同」や相対表記は棋譜テキストに書かれていた分しか入らない。CSA には「同」の表記が
 * 無いため、これを通さないと同じ手が形式によって「☖２二銀」と「☖同　銀」に割れる。
 * 分岐を1つ追加すると applyMoveWithBranch が棋譜全体を正規化するので、
 * 通しておかないと「触っていない手の表記が勝手に変わる」ことになる。
 *
 * 盤上で再生できない手を含む棋譜では正規化が throw する。そのときは元をそのまま返すが、
 * 揃わないのは表記だけではない。**その手より先へは進めない**（`goto` がそこで失敗する）。
 * 利用者への通知は issue #157 の担当。
 */
function normalizeNotation(jkf: JKFData): JKFData {
  try {
    // 正規化は失敗した手に color / same / capture などを書き込んでから throw する。
    // 「同」を tsshogi が先に埋めるのは KIF と KI2 だけで、CSA と JKF は埋めない。
    // コピーを渡さないと、それらの形式で中途半端に書き換わった棋譜が保存側まで流れる。
    return Normalizer.normalizeMinimal(cloneJkf(jkf));
  } catch {
    // 開けること自体を優先して未正規化のまま返す。
    return jkf;
  }
}

/**
 * tsshogi の出力を `JKFData` に仕上げる。棋譜テキストから `JKFData` を作る経路は全てここを通す。
 *
 * 「空の変化を含まない」は `JKFData` の不変条件なので、満たす責任は型を所有する
 * このスライスにある。呼び出し側で `sanitizeJkf` を掛けると、掛けたかどうかが
 * 型から読めない `JKFData` が生まれる。
 */
function finishJKFData(exported: JKFData): JKFData {
  return sanitizeJkf(normalizeNotation(exported));
}

/**
 * 形式が分かっている棋譜テキストを `JKFData` にする
 *
 * 失敗すると {@link KifuParseError} を throw する。空文字と解析失敗の両方がここに来る。
 *
 * 盤上で再生できない手を含む棋譜では throw せず、**未正規化のまま返る**。
 * このとき表記が揃わないだけでなく、その手以降へ `JKFPlayer.goto` が進めない。
 * 返り値を持って局面を動かす側は、`goto` が失敗しうる前提で境界を用意すること
 * （レンダ中に呼ぶと画面が落ちる）。
 *
 * @throws {KifuParseError} 棋譜として読めなかったとき
 */
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
  return finishJKFData(exportJKF(rec) as JKFData);
}

/**
 * 形式が分からない棋譜テキストを、判定した形式ごと `JKFData` にする
 *
 * 未正規化のまま返りうる点と throw する点は {@link parseKifuContentToJKF} と同じ。
 * 形式の判定そのものに失敗した場合も {@link KifuParseError} になる。
 *
 * @throws {KifuParseError} 形式を判定できないか、棋譜として読めなかったとき
 */
export function parseKifuStringToJKF(raw: string): ParsedKifu {
  const text = stripBom(raw).trim();
  if (!text) throw new KifuParseError("空の棋譜です。");

  if (text.startsWith("{") || text.startsWith("[")) {
    const rec = importJKFString(text);
    if (rec instanceof Error) throw new KifuParseError("JKF(JSON)の解析に失敗しました。", rec);
    return { detectedFormat: "jkf", jkf: finishJKFData(exportJKF(rec) as JKFData) };
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

  return { detectedFormat, jkf: finishJKFData(exportJKF(rec) as JKFData) };
}
