import { useEffect, useEffectEvent } from "react";
import { useGame } from "@/entities/game";
import { focusKifuList } from "../lib/kifuListMarker";
import { navigationOf, type KifuNavigation } from "../lib/navigationKey";

/**
 * 画面のキーで棋譜の中を移動する。受ける条件は `navigationOf`、することは `GameControls` のボタンと同じ。
 *
 * **ページの根で1回だけ使う。** フォーカスがどこにあっても受けるので、`window` で聞く。
 */
export function useKifuNavigationKeys(): void {
  const { view, goToStart, previousMove, nextMove, goToEnd } = useGame();
  const { hasKifu } = view;

  const navigate = useEffectEvent((navigation: KifuNavigation) => {
    const run = { start: goToStart, previous: previousMove, next: nextMove, end: goToEnd };
    run[navigation]();
  });

  useEffect(() => {
    if (!hasKifu) return;

    /** 動かした局面を描き終えたか */
    let drawn = true;

    const handleKeyDown = (event: KeyboardEvent) => {
      const navigation = navigationOf(event);
      if (navigation === null) return;

      // 端で動けないときも止める。止めないと、フォーカスのある場所が流れる
      event.preventDefault();

      // 押し続けた分は、1回描くごとに1手まで。描くより速く届いた分を溜めると、離した後も動き続ける
      if (event.repeat && !drawn) return;

      // 動くのは棋譜なので、フォーカスも棋譜に置く。押した場所に残すと、動いていない部品に輪が出る
      focusKifuList();
      navigate(navigation);

      drawn = false;
      requestAnimationFrame(() => {
        drawn = true;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasKifu]);
}
