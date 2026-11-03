import { useLayoutEffect, useRef, useState } from "react";
import { placeBeside, type BesidePlacement } from "../lib/popoverPlacement";

/**
 * 行の横に出す面の位置を測って持つ。`selfRef` を面の要素に付ける。
 *
 * 位置は面を描いた後に測るので、測るまでの `placement` は null になる。
 * 開いている間は、画面の大きさが変わるか、どこかが流れるたびに測り直す。
 */
export function useBesidePlacement(open: boolean, anchorRect: DOMRect | null) {
  const selfRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<BesidePlacement | null>(null);

  const updatePlacement = () => {
    if (!anchorRect) return;
    const pop = selfRef.current;
    if (!pop) return;

    setPlacement(
      placeBeside(
        anchorRect,
        { width: pop.offsetWidth, height: pop.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  useLayoutEffect(() => {
    if (!open || !anchorRect) return;
    // 初回は測定が必要なので rAF で1拍置く
    requestAnimationFrame(updatePlacement);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchorRect?.top, anchorRect?.left, anchorRect?.width, anchorRect?.height]);

  useLayoutEffect(() => {
    if (!open) return;
    const onResize = () => updatePlacement();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { selfRef, placement };
}
