import { useEffect, useRef } from "react";
import { useGame } from "@/entities/game";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 別の棋譜が盤に載ったら向きを既定（先手が手前）へ戻す。向きは棋譜ごとに持ち越さない。
 *
 * **合図は盤に載っている棋譜で、ツリーが開いたと言っているパスではない。**
 * この2つはずれる。`openKifuNode` は構文として読めれば `kifu_opened` を出して
 * `activeKifuPath` を動かすが、盤に載せられない `initial` を持つ棋譜は
 * その先の `loadGame` で落ちる。そのとき盤は前の棋譜のまま。
 * ツリー側を見ていると、そこで**盤に出ている棋譜は変わらないのに向きだけが戻る**。
 *
 * **パスだけでは足りない。改名・移動でも動く。** そのとき変わったのは名前だけで、
 * 盤に並んでいる駒は同じなので向きも同じままでよい。盤の中身が入れ替わったかを持つのは
 * `boardSeq` なので、**2つを組で見る**。
 *
 * **載せられなかったこと自体は `GameFileTreeBridge` が断りとして出す**が、それは
 * 向きを落とす理由にならない。
 *
 * **盤の外で呼ぶ。** 理由は
 * [BoardOrientationBridge](../../../app/providers/bridges/BoardOrientationBridge.tsx) の doc。
 */
export function useResetOrientationOnKifuChange() {
  const { state } = useGame();
  const { params, updateParams } = useURLParams();

  const shownKifuPath = state.loadedAbsPath;
  const boardSeq = state.boardSeq;

  // 初期値は `loadedAbsPath` と `boardSeq` の初期値に揃える。ずらすと、
  // マウント直後のエフェクトが空振りせずに `?pov` を消す
  const shownKifuRef = useRef<{ path: string | null; seq: number }>({ path: null, seq: 0 });

  useEffect(() => {
    const shown = shownKifuRef.current;
    if (shown.path === shownKifuPath && shown.seq === boardSeq) return;

    // 同じ名前のまま盤が入れ替わった回（同じ棋譜を開き直す）。
    // **向きは棋譜に付くので、同じ棋譜なら開き直しても持ち越す。**
    // 踏むのは E16 のあとの復帰導線——前の棋譜をツリーで選び直すと、
    // `loadedAbsPath` と同じパスで `game_loaded` が撃たれる
    const samePath = shown.path === shownKifuPath;

    // **改名・移動。** パスが張り替わったのに盤が入れ替わっていない
    // （`path_renamed` は `boardSeq` を進めない）。盤の中身は同じなので向きは持ち越す。
    // 閉じた回は `reset_state` が `boardSeq` を進めるので、ここには入らない
    const renamed = shown.seq === boardSeq;

    shownKifuRef.current = { path: shownKifuPath, seq: boardSeq };
    if (samePath || renamed) return;

    // 消すものが無ければ履歴を触らない。`updateParams` は削除が空振りでも
    // `navigate` するので、同じ URL でも location の同一性が変わり、
    // `useSearchParams` の読み手（ファイルツリー全行を含む）が丸ごと描き直される
    if (params.pov === undefined) return;

    updateParams({ pov: undefined }, { replace: true });
  }, [shownKifuPath, boardSeq, params.pov, updateParams]);
}
