import { JKFPlayer } from "json-kifu-format";
import type { JKFData } from "../model/jkf";
import { normalizeForkPointers, type CursorPath } from "../model/cursor";

/**
 * `goto` は届かないときに throw せず、進めるところで黙って止まる。
 * `forkAndForward` の返り値も見ないので、実在しない変化は黙って捨て、そこまでに降りた線を進む。
 *
 * @throws {Error} 盤上で再生できない手に当たったとき、
 *   `forkPointers` が手の無い te を指しているとき
 * @throws {TypeError} `forkIndex` が負・非整数のとき（`forks[-1]` を掴む）
 */
function applyCursorToPlayer(player: JKFPlayer, cursor: CursorPath | null) {
  if (!cursor) return;
  player.goto(cursor.tesuu, normalizeForkPointers(cursor.forkPointers, cursor.tesuu));
}

/**
 * JKF とカーソルから再生済みの player を作る
 *
 * `jkf` は複製されない。読むだけなら1つの JKF を複数の player が共有してよい
 * （`JKFPlayer` は `inputMove` 以外で棋譜を書かず、盤は `Shogi` が持ち直す）。
 * **棋譜を書き換える操作を通すなら複製を渡すこと。** `inputMove` だけでなく、
 * `applyMoveWithBranch` のように `player.kifu` を直に編集するものも含む。
 *
 * **要求した局面に着くとは限らない。** ずれ方は2つある。
 *
 * - `goto` は届かなければ進めるところで黙って止まる（`tesuu` がずれる）
 * - `goto` は `forkAndForward` の返り値を見ないので、実在しない変化は黙って捨てられ、
 *   **要求した `tesuu` ちょうどで別の線に着く**（`tesuu` は一致する）
 *
 * したがって `tesuu` の比較では後者を検出できない。一致を要求する側は
 * `player.getTesuuPointer(cursor.tesuu)` を `cursor.tesuuPointer` と突き合わせること。
 *
 * @throws {Error} 盤上で再生できない手に当たったとき、`forkPointers` が手の無い te を
 *   指しているとき。レンダ中に呼ぶなら呼び出し側で捕まえること（捕まえないと画面が落ちる）
 * @throws {TypeError} `forkPointers` の `forkIndex` が負・非整数のとき。
 *   `forks[-1]` を掴んで `JKFPlayer` の内部で落ちる
 */
export function buildPlayer(jkf: JKFData, cursor: CursorPath | null): JKFPlayer {
  const player = new JKFPlayer(jkf);
  applyCursorToPlayer(player, cursor);
  return player;
}
