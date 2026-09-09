/**
 * shogi.js と tsshogi の手番の綴りを行き来させる。
 *
 * **同じ「先手／後手」を2つのライブラリが別の型で持っている。**
 * shogi.js の `Color` は数値の enum、tsshogi の `Color` は文字列の enum。
 * 盤の表示と合法手は shogi.js、千日手と持将棋の点数は tsshogi が持つので
 * （`gameOutcome.ts` の冒頭）、境目で必ず1回変換が要る。
 *
 * **公開する型は shogi.js 側に寄せてある。** `GameView.currentTurn` も
 * `SelectedPosition` も `entities/game` は既にそちらで書かれていて、
 * tsshogi の綴りが混ざると呼び出し側が2つの手番型を持つことになる。
 */
import { Color } from "shogi.js";
import { Color as TsColor } from "tsshogi";

export function toTsColor(color: Color): TsColor {
  return color === Color.Black ? TsColor.BLACK : TsColor.WHITE;
}

export function fromTsColor(color: TsColor): Color {
  return color === TsColor.BLACK ? Color.Black : Color.White;
}

/** 相手の手番 */
export function opponentOf(color: Color): Color {
  return color === Color.Black ? Color.White : Color.Black;
}
