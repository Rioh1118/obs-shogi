import { JKFPlayer } from "json-kifu-format";
import type { JKFData } from "../model/jkf";
import type { ForkPointer, KifuCursor } from "../model/cursor";

/** 読むのは forkPointers だけ。ダミーの tesuuPointer を作らせないよう引数を狭めてある。 */
export function appliedForkPointers(
  cursor: Pick<KifuCursor, "forkPointers"> | null,
  tesuu: number,
): ForkPointer[] {
  const map = new Map<number, ForkPointer>();
  for (const p of cursor?.forkPointers ?? []) {
    if (p.te <= tesuu) map.set(p.te, p);
  }
  return [...map.values()].sort((a, b) => a.te - b.te);
}

/** @throws {Error} cursor の手数まで進めないとき（`JKFPlayer.goto` が投げる） */
export function applyCursorToPlayer(jkf: JKFPlayer, cursor: KifuCursor | null) {
  if (!cursor) return;
  jkf.goto(cursor.tesuu, appliedForkPointers(cursor, cursor.tesuu));
}

/**
 * JKF とカーソルから再生済みの player を作る
 *
 * `jkf` は複製されない。読むだけなら1つの JKF を複数の player が共有してよい
 * （`JKFPlayer` は `inputMove` 以外で棋譜を書かず、盤は `Shogi` が持ち直す）。
 * **棋譜を書き換える操作を通すなら複製を渡すこと。** `inputMove` だけでなく、
 * `applyMoveWithBranch` のように `player.kifu` を直に編集するものも含む。
 *
 * @throws {Error} 未正規化の棋譜などで cursor の手数まで進めないとき。
 *   レンダ中に呼ぶなら呼び出し側で捕まえること（捕まえないと画面が落ちる）
 */
export function buildPlayer(jkf: JKFData, cursor: KifuCursor | null): JKFPlayer {
  const player = new JKFPlayer(jkf);
  applyCursorToPlayer(player, cursor);
  return player;
}
