import type { JKFPlayer } from "json-kifu-format";
import { makeKifuCursor, type KifuCursor } from "../model/cursor";

/**
 * 再生し終えた player から `KifuCursor` を作る。
 *
 * **`KifuCursor` を作る道はこれ1本。** 3つの値を同じ player の同じ `tesuu` から
 * 取るのは `makeKifuCursor` の要求（別々に組むと `tesuuPointer` が中身と食い違う）。
 *
 * 到達したかを確かめるために `getTesuuPointer(tesuu)` を単体で読むのは別の話
 * （`buildPlayer` の doc）。`PreviewData.nodeId` のために直に読んでいる2箇所は #302。
 * カーソルへ player を動かす側は `buildPlayer` / `gotoPath`。
 */
export function cursorFromPlayer(player: JKFPlayer): KifuCursor {
  const tesuu = player.tesuu;
  return makeKifuCursor(tesuu, player.getForkPointers(tesuu), player.getTesuuPointer(tesuu));
}
