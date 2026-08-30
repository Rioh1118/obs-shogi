import type { JKFPlayer } from "json-kifu-format";
import { cursorKey, makeKifuCursor, type CursorPath, type KifuCursor } from "../model/cursor";

/**
 * 再生し終えた player から `KifuCursor` を作る。
 *
 * **再生器から `KifuCursor` を作る道はこれ1本**（定数の `ROOT_CURSOR` を除く）。
 * 3つの値を同じ player の同じ `tesuu` から
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

/**
 * 要求した局面に本当に着いたか。
 *
 * `goto` は実在しない変化を黙って捨て、**要求した `tesuu` ちょうどで別の線に着く**ので、
 * `tesuu` の比較では検出できない（`buildPlayer` の doc）。観測値と要求の鍵を突き合わせる。
 *
 * この比較を呼び出し側で書くと `getTesuuPointer` の直呼びになり、
 * `src/__tests__/playerAccess.test.ts` のラチェットに掛かる。ここを通すこと。
 */
export function reachedCursor(player: JKFPlayer, path: CursorPath): boolean {
  return player.getTesuuPointer(path.tesuu) === cursorKey(path);
}
