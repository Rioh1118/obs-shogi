import { useCallback } from "react";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 盤をどちら側から見るかを読み、切り替える。`?pov=gote` なら後手を手前にする。
 *
 * 読む側と書く側をここに揃えてある。既定を値の欠落で表しているので、別々に綴ると
 * 片方だけ直したときに「ボタンは回るがリセットが効かない」形で静かに壊れる。
 *
 * URL の文字列を絞る検査は `useURLParams` の `povRaw === "gote"` にあり、
 * `PovType` は型だけを持つ。表現を増やすなら検査も直すこと。
 * union が広がっても検査は代入可能なままなので、**tsc は落ちない。**
 *
 * 棋譜をまたいで持ち越さないための落とす側は
 * [useResetOrientationOnKifuChange](./useResetOrientationOnKifuChange.ts)。
 * そちらは盤が描かれていない間も走る必要があるので、別の場所に載る。
 */
export function useBoardOrientation() {
  const { params, updateParams } = useURLParams();

  const isGotePov = params.pov === "gote";

  const toggle = useCallback(() => {
    updateParams({ pov: isGotePov ? undefined : "gote" }, { replace: true });
  }, [isGotePov, updateParams]);

  return { isGotePov, toggle };
}
