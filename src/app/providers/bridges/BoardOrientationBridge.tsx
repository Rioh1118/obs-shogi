import { useResetOrientationOnKifuChange } from "@/features/board-orientation";

/**
 * 盤の向きを棋譜ごとに持ち越さないための橋。**置き場の理由はここが持つ。**
 *
 * 落とす判断は棋譜が無い間も走らないといけないが、盤は棋譜が開いている間しか
 * 描かれない（`AppLayout` が `WelcomeScreen` と切り替える）。盤の中で呼ぶと、
 * 棋譜を閉じた瞬間に盤ごと unmount して落とす者が居なくなり、`?pov=gote` が URL に残る。
 */
export function BoardOrientationBridge() {
  useResetOrientationOnKifuChange();

  return null;
}
