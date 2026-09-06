import { useEffect, useRef } from "react";
import { useGame } from "@/entities/game";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 別の棋譜が盤に載ったら向きを既定（先手が手前）へ戻す。向きは棋譜ごとに持ち越さない。
 *
 * **合図は盤に載っている棋譜（`loadedAbsPath`）で、ツリーが開いたと言っているパスではない。**
 * この2つはずれる。`openKifuNode` は構文として読めれば `kifu_opened` を出して
 * `activeKifuPath` を動かすが、盤に載せられない `initial` を持つ棋譜は
 * その先の `loadGame` で落ちる。そのとき盤は前の棋譜のままで、`error` を出す先も無い。
 * ツリー側を見ていると、そこで**何も言われないのに盤が回る**。
 * `loadedAbsPath` は `game_loaded` でしか動かないので、定義上「盤に載っている棋譜」。
 *
 * **盤の外で呼ぶ。** 棋譜が無い間は盤そのものが描かれないので、盤の中から呼ぶと
 * 棋譜を閉じたときに落とす者が居なくなり、`?pov=gote` が URL に残ったままになる。
 */
export function useResetOrientationOnKifuChange() {
  const { state } = useGame();
  const { params, updateParams } = useURLParams();

  const shownKifuPath = state.loadedAbsPath;

  // 初期値は `loadedAbsPath` の初期値と揃える。ずらすと、マウント直後のエフェクトが
  // 空振りせずに `?pov` を消す
  const shownKifuPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (shownKifuPathRef.current === shownKifuPath) return;
    shownKifuPathRef.current = shownKifuPath;

    // 消すものが無ければ履歴を触らない。`updateParams` は削除が空振りでも
    // `navigate` するので、同じ URL でも location の同一性が変わり、
    // `useLocation` の読み手（ファイルツリー全行を含む）が丸ごと描き直される
    if (params.pov === undefined) return;

    updateParams({ pov: undefined }, { replace: true });
  }, [shownKifuPath, params.pov, updateParams]);
}
