import { useResetOrientationOnKifuChange } from "@/features/board-orientation";

/**
 * 盤の向きを棋譜ごとに持ち越さないための橋。
 *
 * **盤より上に置く。** 落とす判断は棋譜が無い間も走らないといけないが、盤は
 * 棋譜が開いている間しか描かれない（`AppLayout` が `WelcomeScreen` と切り替える）。
 */
export function BoardOrientationBridge() {
  useResetOrientationOnKifuChange();

  return null;
}
