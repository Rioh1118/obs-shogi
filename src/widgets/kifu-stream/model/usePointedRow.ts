import { useCallback, useEffect, useRef } from "react";

/** 指されている行に付ける属性。見た目は `KifuMoveCard.scss` */
const POINTED = "data-pointed";

/**
 * ポインタを動かして指した行に、属性を付ける。
 *
 * `:hover` は、一覧が流れたときや、重なっていた付箋が消えたときに、止まったポインタの下へ来ただけの行にも付く。
 * 付くと、いまの手の行と2つ選ばれて見える。
 *
 * 属性は直接付け外しする。行の props にすると、ポインタが行を跨ぐたびに一覧を描き直す。
 *
 * @param positionKey 局面の識別子。変わったら外す
 * @returns 外す関数。一覧が流れたときと、ポインタが一覧から出たときに呼ぶ
 */
export function usePointedRow(positionKey: string): () => void {
  const pointedRef = useRef<HTMLElement | null>(null);

  const point = useCallback((row: HTMLElement | null) => {
    if (pointedRef.current === row) return;
    pointedRef.current?.removeAttribute(POINTED);
    row?.setAttribute(POINTED, "");
    pointedRef.current = row;
  }, []);

  useEffect(() => {
    let at = { x: NaN, y: NaN };

    // `window` で聞く。一覧で聞くと、重なっていた付箋の上での最後の座標を知らず、
    // 付箋が消えた後に WebKit が送る `pointermove` を、動いたと見なす
    const handlePointerMove = (e: PointerEvent) => {
      // WebKit は、止まったポインタの下で描き直しただけでも `pointermove` を送る
      if (e.clientX === at.x && e.clientY === at.y) return;
      at = { x: e.clientX, y: e.clientY };

      point(e.target instanceof Element ? e.target.closest<HTMLElement>(".kifu-row") : null);
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    return () => window.removeEventListener("pointermove", handlePointerMove, true);
  }, [point]);

  const clear = useCallback(() => point(null), [point]);

  useEffect(clear, [clear, positionKey]);

  return clear;
}
