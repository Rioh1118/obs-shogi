import { useLayoutEffect, useRef, useState } from "react";
import { placeBeside, type BesidePlacement } from "../lib/popoverPlacement";

/**
 * 行の横に出すサーフェスの位置を測って持つ。`selfRef` をサーフェスの要素に付ける。
 *
 * 位置はサーフェスを描いた後に測る。最初に開いたときは測るまで null で、閉じても戻さないので、
 * 開き直したときは測り直すまでの1拍だけ前の位置を持つ。
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
