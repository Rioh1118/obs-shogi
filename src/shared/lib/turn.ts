import { Color } from "shogi.js";

/**
 * 先後を表す駒の記号。
 *
 * どちらがどちらかは字面から読み取れず、直書きすると取り違える。記号を画面に出す箇所はここを通す。
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
 * 文の中に混ぜる語を返す。記号を付けない。
 *
 * `shogi.js` の `colorToString` も同じ語を返すが、呼ばない。
 * 出典が2つになると、記号を付けるかどうかの判断もそこで割れる。
 */
export function turnSide(color: Color): "先手" | "後手" {
  return color === Color.Black ? "先手" : "後手";
}

/** 記号を出さず「〜番」で言う語を返す */
export function turnText(color: Color): "先手番" | "後手番" {
  return color === Color.Black ? "先手番" : "後手番";
}

/**
 * 記号を添えた「〜番」を返す。盤の横の表示のように、周りの文が意味を補わない場所で使う。
 *
 * 呼び手で `turnGlyph` と `turnText` を並べない。記号と語のあいだの空白が呼び手ごとに割れる。
 */
export function turnBadgeText(color: Color): string {
  return `${turnGlyph(color)} ${turnText(color)}`;
}
