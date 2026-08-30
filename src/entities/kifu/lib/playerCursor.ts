import type { JKFPlayer } from "json-kifu-format";
import { makeKifuCursor, type KifuCursor } from "../model/cursor";

/**
 * 再生し終えた player から `KifuCursor` を作る。
 *
 * **player から観測値を取る道はこれ1本。** `getTesuuPointer` / `getForkPointers` を
 * 外で直に呼ばないこと。3つの値を同じ player の同じ `tesuu` から取るのは
 * `makeKifuCursor` の要求（別々に組むと `tesuuPointer` が中身と食い違う）。
 *
 * カーソルへ player を動かす側は `buildPlayer` / `gotoPath`。
 */
export function cursorFromPlayer(player: JKFPlayer): KifuCursor {
  const tesuu = player.tesuu;
  return makeKifuCursor(tesuu, player.getForkPointers(tesuu), player.getTesuuPointer(tesuu));
}
