import { useCallback } from "react";
import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 盤をどちら側から見るか。`?pov=gote` なら後手を手前にする。
 *
 * **`?pov` の符号化を知っているのはここだけ。** 既定を値の欠落で表しているので、
 * 読む側と書く側が別々に綴ると、片方だけ直したときに
 * 「ボタンは回るがリセットが効かない」形で静かに壊れる。
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
