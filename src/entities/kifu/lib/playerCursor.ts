import type { JKFPlayer } from "json-kifu-format";
import {
  cursorKey,
  makeKifuCursor,
  pointsAtSame,
  type CursorPath,
  type KifuCursor,
  type TesuuPointer,
} from "../model/cursor";

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
 * 移動・編集の**前**の観測値を取る。
 *
 * 前後の比較は**再生器が返した観測値**どうしでしか成立しない。要求の鍵
 * （`cursorKey`）に置き換えると、要求どおりに着けたかに関わらず一致してしまい、
 * **盤が動かないのにエラーも出ない**。`KifuCursor.tesuuPointer` に観測値しか
 * 入れないという規約（`entities/kifu/model/cursor.ts`）は、この比較を守るためにある。
 *
 * `cursor` が無い（棋譜を開いた直後）ときは、いま盤に出ている局面を観測して使う。
 */
export function observedPointerOf(cursor: KifuCursor | null, player: JKFPlayer): TesuuPointer {
  return cursor?.tesuuPointer ?? cursorFromPlayer(player).tesuuPointer;
}

/**
 * 要求した局面に本当に着いたか。**`buildPlayer` が挙げる2つのずれの両方を見る。**
 *
 * - 届かずに手前で止まった（`tesuu` がずれる）
 * - 要求した `tesuu` ちょうどで別の線に着いた（`tesuu` は一致する）
 *
 * 観測を `cursorFromPlayer` から取るのが要点。`player.getTesuuPointer(tesuu)` は
 * **引数の `tesuu` をそのまま文字列に埋めるだけで `player.tesuu` を見ない**ので、
 * 手前で止まっていても要求どおりの鍵が返り、1つ目を素通りする。
 *
 * **いま本番でこれを呼ぶ側は無い。** 検索ヒットからの移動（`usePositionHitNavigation`）で
 * 突き合わせる作業は → #296。
 *
 * この比較を呼び出し側で書くと `getTesuuPointer` の直呼びになり、
 * `src/__tests__/playerAccess.test.ts` のラチェットに掛かる。ここを通すこと。
 */
export function reachedCursor(player: JKFPlayer, path: CursorPath): boolean {
  return pointsAtSame(cursorFromPlayer(player).tesuuPointer, cursorKey(path));
}
