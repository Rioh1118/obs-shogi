import { useURLParams } from "@/shared/lib/router/useURLParams";

/**
 * 盤をどちら側から見るか。`?pov=gote` なら後手を手前にする。
 *
 * **読むだけ。落とす判断は持たない。** 落とすのは
 * [useResetOrientationOnKifuChange](./useResetOrientationOnKifuChange.ts) で、
 * そちらは盤が描かれていない間も走る必要がある。
 */
export function useBoardOrientation() {
  const { params } = useURLParams();

  return { rotate: params.pov === "gote" };
}
