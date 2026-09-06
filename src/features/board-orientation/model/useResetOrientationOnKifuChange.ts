import { useEffect, useRef } from "react";
import { useFileTree } from "@/entities/file-tree";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 別の棋譜が盤に載ったら向きを既定（先手が手前）へ戻す。向きは棋譜ごとに持ち越さない。
 *
 * **戻す合図は `activeKifuPath` で、ツリーの選択ではない。** この2つはずれる。
 * `openKifuNode` は読み込みに失敗すると選択だけを元へ巻き戻すので、選択を見ていると
 * 開けなかった棋譜をクリックしただけで向きが戻る。そのとき盤は前の棋譜のままなので、
 * 利用者から見ると「開けませんでした」と言われただけで盤が勝手に回る。
 *
 * **盤の外で呼ぶ。** 棋譜が無い間は盤そのものが描かれないので、盤の中から呼ぶと
 * 棋譜を閉じたときに落とす者が居なくなり、`?pov=gote` が URL に残ったままになる。
 */
export function useResetOrientationOnKifuChange() {
  const { activeKifuPath } = useFileTree();
  const { updateParams } = useURLParams();

  // 盤に載っている棋譜。null は「まだ何も載っていない」で、`activeKifuPath` の初期値と同じ
  const shownKifuRef = useRef<string | null>(null);

  useEffect(() => {
    if (shownKifuRef.current === activeKifuPath) return;
    shownKifuRef.current = activeKifuPath;
    updateParams({ pov: undefined }, { replace: true });
  }, [activeKifuPath, updateParams]);
}
