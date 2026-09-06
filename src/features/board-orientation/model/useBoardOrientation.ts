import { useEffect, useRef } from "react";
import { useFileTree } from "@/entities/file-tree";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 盤をどちら側から見るか。`?pov=gote` なら後手を手前にする。
 *
 * 向きは棋譜ごとに持ち越さない。別の棋譜に移ったら既定（先手が手前）へ戻す。
 *
 * **戻す合図は `activeKifuPath` で、ツリーの選択ではない。** この2つはずれる。
 * `openKifuNode` は読み込みに失敗すると選択だけを元へ巻き戻すので、選択を見ていると
 * 開けなかった棋譜をクリックしただけで向きが戻る。そのとき盤は前の棋譜のままなので、
 * 利用者から見ると「開けませんでした」と言われただけで盤が勝手に回る。
 */
export function useBoardOrientation() {
  const { activeKifuPath } = useFileTree();
  const { params, updateParams } = useURLParams();

  // 盤に載っている棋譜。null は「まだ何も載っていない」で、`activeKifuPath` の初期値と同じ
  const shownKifuRef = useRef<string | null>(null);

  useEffect(() => {
    if (shownKifuRef.current === activeKifuPath) return;
    shownKifuRef.current = activeKifuPath;
    updateParams({ pov: undefined }, { replace: true });
  }, [activeKifuPath, updateParams]);

  return { rotate: params.pov === "gote" };
}
