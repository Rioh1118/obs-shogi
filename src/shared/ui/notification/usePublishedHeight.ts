import { useLayoutEffect, type RefObject } from "react";

/**
 * 要素の高さを、ルートのカスタムプロパティに置く。要素が無くなったら消す。
 *
 * 帯は画面とモーダルの上に重ねて描くので、どちらもこの高さだけ下へ始まる。
 *
 * @param isShown 要素を描いているか。変わったら付け直す
 */
export function usePublishedHeight(
  ref: RefObject<HTMLElement | null>,
  property: string,
  isShown: boolean,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !isShown) return;

    const { style } = document.documentElement;
    const publish = () => style.setProperty(property, `${el.offsetHeight}px`);
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      style.removeProperty(property);
    };
  }, [ref, property, isShown]);
}
