import { useEffect, useRef } from "react";
import { useGame } from "@/entities/game";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 別の棋譜が盤に載ったら向きを既定（先手が手前）へ戻す。向きは棋譜ごとに持ち越さない。
 *
 * **合図は盤に載っている棋譜（`loadedAbsPath`）で、ツリーが開いたと言っているパスではない。**
 * この2つはずれる。`openKifuNode` は構文として読めれば `kifu_opened` を出して
 * `activeKifuPath` を動かすが、盤に載せられない `initial` を持つ棋譜は
 * その先の `loadGame` で落ちる。そのとき盤は前の棋譜のまま。
 * ツリー側を見ていると、そこで**盤に出ている棋譜は変わらないのに向きだけが戻る**。
 * `loadedAbsPath` は `game_loaded` でしか動かないので、定義上「盤に載っている棋譜」。
 *
 * **載せられなかったこと自体は `GameFileTreeBridge` が断りとして出す**が、それは
 * 向きを落とす理由にならない。盤に並んでいる駒が同じなら、向きも同じままでよい。
 *
 * **盤の外で呼ぶ。** 理由は
 * [BoardOrientationBridge](../../../app/providers/bridges/BoardOrientationBridge.tsx) の doc。
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
    // `useSearchParams` の読み手（ファイルツリー全行を含む）が丸ごと描き直される
    if (params.pov === undefined) return;

    updateParams({ pov: undefined }, { replace: true });
  }, [shownKifuPath, params.pov, updateParams]);
}
