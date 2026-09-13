/**
 * 手番の綴りを行き来させる。**同じ「先手／後手」を3つの型が持っている。**
 *
 * | 綴り                              | 誰のものか                                    | ここから出る口              |
 * | --------------------------------- | --------------------------------------------- | --------------------------- |
 * | shogi.js の `Color`（数値 enum）  | 盤の表示と合法手（`GameView.currentTurn`）   | `tsColorToColor` の戻り値   |
 * | tsshogi の `Color`（文字列 enum） | 千日手と持将棋の点数（tsshogi へ渡す値）     | `sideToTsColor` の戻り値    |
 * | `Side`（`"black"` / `"white"`）   | Rust との境界（`endGameByRule` の `winner`） | `colorToSide` の戻り値      |
 *
 * **名前は `<源>To<先>` で揃える。** 揃えないと、`colorToSide(opponentOf(tsColorToColor(x)))`
 * のように重ねたときに、途中の値がどの綴りなのかを名前から追えなくなる。
 *
 * **外へ出すのは `Side`。** shogi.js の `Color.Black` は `0` なので、
 * 引き分けを `null` で表す欄に入れると `winner ? … : 引き分け` が
 * **先手勝ちを引き分けに潰す**。tsc は通す。`Side` は両方とも真値なので潰れない。
 *
 * 綴りが割れていること自体は #364 が扱っている。ここはその割れ目に橋を1本置くだけ。
 */
import { Color } from "shogi.js";
import { Color as TsColor } from "tsshogi";

import type { Side } from "@/entities/game-session";

export function colorToSide(color: Color): Side {
  return color === Color.Black ? "black" : "white";
}

export function sideToTsColor(side: Side): TsColor {
  return side === "black" ? TsColor.BLACK : TsColor.WHITE;
}

export function tsColorToColor(color: TsColor): Color {
  return color === TsColor.BLACK ? Color.Black : Color.White;
}

/** 相手の手番。**綴りの変換ではない**ので `<源>To<先>` の規則には載らない */
export function opponentOf(color: Color): Color {
  return color === Color.Black ? Color.White : Color.Black;
}
