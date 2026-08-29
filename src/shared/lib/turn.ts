import { Color } from "shogi.js";

/**
 * 先後を表す駒の記号
 *
 * どちらがどちらかは字面から読み取れないため、直書きすると取り違えやすい。
 * 記号を画面に出す箇所はここを通すこと。
 */
export const SENTE_GLYPH = "☗";
export const GOTE_GLYPH = "☖";

export type TurnGlyph = typeof SENTE_GLYPH | typeof GOTE_GLYPH;

export function turnGlyph(color: Color): TurnGlyph {
  return color === Color.Black ? SENTE_GLYPH : GOTE_GLYPH;
}

/** 記号と語の対。片方だけ書き換えると食い違うので、対で持つ。 */
export const SENTE_LABEL = `${SENTE_GLYPH}先手`;
export const GOTE_LABEL = `${GOTE_GLYPH}後手`;

export function turnLabel(color: Color): string {
  return color === Color.Black ? SENTE_LABEL : GOTE_LABEL;
}

/** 記号を出さず「〜番」で言う場合。`turnLabel` とは別物なので名前を分けてある。 */
export function turnText(color: Color): "先手番" | "後手番" {
  return color === Color.Black ? "先手番" : "後手番";
}
