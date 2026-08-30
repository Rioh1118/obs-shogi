import type { JKFPlayer } from "json-kifu-format";
import { makeKifuCursor, type KifuCursor } from "../model/cursor";

/**
 * 再生し終えた player から `KifuCursor` を作る。
 *
 * `JKFPlayer` への依存をこの1本に閉じてある。3つの値を同じ player の
 * 同じ `tesuu` から取るのは `makeKifuCursor` の要求（別々に組むと
 * `tesuuPointer` が中身と食い違う）。
 */
export function cursorFromPlayer(player: JKFPlayer): KifuCursor {
  const tesuu = player.tesuu;
  return makeKifuCursor(tesuu, player.getForkPointers(tesuu), player.getTesuuPointer(tesuu));
}
