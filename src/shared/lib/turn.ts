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

/**
 * 文の中に混ぜる語。記号を付けない
 *
 * **`shogi.js` の `colorToString` を呼ばない。** 同じ「先手」を返すが、
 * 出典が2つになると、記号を付ける／付けないの判断もそこで割れる
 * （文の中で `☗先手の歩が` と書くと読点の無い行に記号が並ぶ）。
 */
export function turnSide(color: Color): "先手" | "後手" {
  return color === Color.Black ? "先手" : "後手";
}

/** 記号を出さず「〜番」で言う場合。`turnLabel` とは別物なので名前を分けてある。 */
export function turnText(color: Color): "先手番" | "後手番" {
  return color === Color.Black ? "先手番" : "後手番";
}

/**
 * 記号を添えた「〜番」。盤に添える札のように、**周りの文が意味を補ってくれない
 * 場所**で使う。
 *
 * 呼び手で `turnGlyph` と `turnText` を並べない。並べると記号と語のあいだに
 * 空白を入れるかどうかが呼び手ごとに割れる（画面の綴りはヘッダーの
 * `☗ 先手番` に揃える）。
 */
export function turnBadgeText(color: Color): string {
  return `${turnGlyph(color)} ${turnText(color)}`;
}
