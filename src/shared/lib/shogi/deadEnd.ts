import { Color, type Kind } from "shogi.js";

const BOARD_RANKS = 9;

/**
 * その駒が動けなくなる段の深さ。0 はどの段でも動ける
 *
 * `shogi.js` の `getIllegalUnpromotedRow` と同じ式。向こうは private なので写している。
 */
function illegalUnpromotedRow(kind: Kind): number {
  switch (kind) {
    case "FU":
    case "KY":
      return 1;
    case "KE":
      return 2;
    default:
      return 0;
  }
}

/** その駒から見て、相手陣の端から数えた段数。先手は上（y が小さい方）が相手陣 */
function rowToOppositeEnd(y: number, color: Color): number {
  return color === Color.Black ? y : BOARD_RANKS + 1 - y;
}

/**
 * `color` の `kind` が段 `y` にいると、この先どこへも動けないかを返す。
 *
 * `shogi.js` の `move` が強制的に成らせる条件と同じ。
 * 深さ0の駒は `y` が必ず1以上なので常に `false` になる。
 */
export function isDeadEnd(kind: Kind, color: Color, y: number): boolean {
  return illegalUnpromotedRow(kind) >= rowToOppositeEnd(y, color);
}
