import { Shogi } from "shogi.js";
import type { PreviewData } from "@/entities/position/model/preview";
import { previewFromShogi } from "./buildPreviewData";
import { stateFromSfen } from "./positionDraft";

/**
 * SFEN 文字列から PreviewData を構築する。読めなければ `null` を返す。
 * JKFPlayer を経由せず、shogi.js の Shogi クラスで盤面を直接復元する。
 *
 * **`initializeFromSFENString` の前に `stateFromSfen` で形を見る。** 持ち駒の枚数に線形な
 * 処理が画面を止める。SFEN の出どころ（`study_positions.json`、URL の `sfen=`）は
 * どちらも検査を通っていない。`stateFromSfen` が同じ呼び出しを済ませているので、
 * ここまで来た文字列の読み込みは失敗しない。
 */
export function buildPreviewDataFromSfen(sfen: string): PreviewData | null {
  if (!stateFromSfen(sfen)) return null;

  const shogi = new Shogi();
  shogi.initializeFromSFENString(sfen);
  return previewFromShogi(shogi, 0, "sfen-preview");
}
