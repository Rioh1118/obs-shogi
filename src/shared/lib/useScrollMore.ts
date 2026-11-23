import { useEffect, useState } from "react";

/** これより残りが少なければ、続きがあると言わない（端数の丸めで動かさない） */
const SLACK = 8;

/**
 * 下に続きがあるかを、送る箱の `data-more` に書く。返す ref を送る箱に渡す。
 *
 * スクロールバーを出さない一覧で、続きの手掛かり（下端を薄くする）を付けるために使う。
 * 行の増減は箱の大きさを変えないので、描くたびに見直す。
 *
 * 箱を state で受けるのは、外して付け直された箱にも付け直すため。読み込みの間だけ箱を外す一覧
 * （`EngineTab`）で、最初の箱に付けたままにすると、付け直した箱は送っても `data-more` が外れない
 */
export function useScrollMore<T extends HTMLElement>(): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);

  useEffect(() => {
    if (el) markMore(el);
  });

  useEffect(() => {
    if (!el) return;

    const update = () => markMore(el);
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [el]);

  return setEl;
}

function markMore(el: HTMLElement) {
  el.toggleAttribute("data-more", el.scrollHeight - el.scrollTop - el.clientHeight > SLACK);
}
