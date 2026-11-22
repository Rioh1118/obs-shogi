import { useRef } from "react";
import { keepInViewport } from "@/shared/lib/keepInViewport";
import { stemLength } from "@/shared/lib/path";

type Props = {
  name: string;
  /** ファイルの名前か。拡張子を省かずに残し、薄くする */
  isFile?: boolean;
  className?: string;
  /** 行を掴んで動かしている。吹き出しを出さない */
  isDragging?: boolean;
};

/** 全文を出す吹き出し。置き場所は `FileTree` */
const TOOLTIP_ID = "filetree-tooltip";

type Popover = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

function tooltip(): Popover | null {
  return document.getElementById(TOOLTIP_ID);
}

/**
 * ツリーの行の名前。入りきらないときは拡張子の手前を省き、指すと全文を吹き出しで出す。
 *
 * 拡張子まで省くと、同じ局面の `.kif` と `.csa` が同じ表示になる。
 */
function NodeName({ name, isFile = false, className = "", isDragging = false }: Props) {
  const stemRef = useRef<HTMLSpanElement | null>(null);
  const cut = isFile ? stemLength(name) : name.length;

  const showTooltip = () => {
    const el = stemRef.current;
    if (!el || isDragging) return;

    const isOverflowing = el.scrollWidth > el.clientWidth + 1;
    if (!isOverflowing) return;

    const pop = tooltip();
    if (!pop?.showPopover) return;

    pop.textContent = name;

    const r = el.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.showPopover();

    // 大きさが決まってから丸める。下端の行では行の下が画面外になり、
    // `popover` は top layer にいて何にもクリップされないので、
    // 丸めないと名前を確かめる手段がその行だけ無くなる
    const box = keepInViewport(
      { x: r.left, y: r.bottom + 10 },
      { width: pop.offsetWidth, height: pop.offsetHeight },
    );
    pop.style.left = `${box.left}px`;
    pop.style.top = `${box.top}px`;
  };

  const hideTooltip = () => tooltip()?.hidePopover?.();

  return (
    <span
      className={`node-name ${className}`}
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <span ref={stemRef} className="node-name__stem">
        {name.slice(0, cut)}
      </span>
      {cut < name.length && <span className="node-name__ext">{name.slice(cut)}</span>}
    </span>
  );
}

export default NodeName;
