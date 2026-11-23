import { useEffect, type RefObject } from "react";

/** これより残りが少なければ、続きがあると言わない（端数の丸めで動かさない） */
const SLACK = 8;

/**
 * 下に続きがあるかを、送る箱の `data-more` に書く。
 *
 * スクロールバーを出さない一覧で、続きの手掛かり（下端を薄くする）を付けるために使う。
 * 行の増減は箱の大きさを変えないので、描くたびに見直す。
 */
export function useScrollMore(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (el) markMore(el);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => markMore(el);
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref]);
}

function markMore(el: HTMLElement) {
  el.toggleAttribute("data-more", el.scrollHeight - el.scrollTop - el.clientHeight > SLACK);
}
