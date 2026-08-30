import type { JKFPlayer } from "json-kifu-format";
import { cursorFromSource, type KifuCursor } from "../model/cursor";

/**
 * 再生し終えた player から `KifuCursor` を作る。
 *
 * `model/cursor.ts` の `cursorFromSource` に `JKFPlayer` を差す口。型の側が
 * `JKFPlayer` クラスに直接依存しないよう、具体の依存はここに閉じてある。
 */
export function cursorFromPlayer(player: JKFPlayer): KifuCursor {
  return cursorFromSource({
    tesuu: player.tesuu,
    getForkPointers: (tesuu?: number) => player.getForkPointers(tesuu),
    getTesuuPointer: (tesuu?: number) => player.getTesuuPointer(tesuu),
  });
}
