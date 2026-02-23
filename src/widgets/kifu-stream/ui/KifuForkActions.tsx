import type React from "react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import "./KifuForkActions.scss";

type Props = {
  open: boolean;
  busy: boolean;

  canUp: boolean;
  canDown: boolean;

  anchorRect: DOMRect | null;
  onClose: () => void;

  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

const KifuForkActions = memo(function KifuForkActions({
  open,
  busy,
  canUp,
  canDown,
  anchorRect,
  onClose,
  onUp,
  onDown,
  onDelete,
}: Props) {
  const selfRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: "right" | "left";
  } | null>(null);

  const updatePosition = () => {
    if (!anchorRect) return;
    const pop = selfRef.current;
    if (!pop) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const mw = pop.offsetWidth;
    const mh = pop.offsetHeight;

    const gap = 8;
    const margin = 8;

    // まず「右」
    let placement: "right" | "left" = "right";
    let left = anchorRect.right + gap;

    // 入らなければ左へ反転（※“右に出す”を基本にしつつ、破綻回避）
    if (left + mw + margin > vw) {
      placement = "left";
      left = anchorRect.left - mw - gap;
    }

    left = clamp(left, margin, vw - mw - margin);

    // 行の中心に合わせる
    const idealTop = anchorRect.top + anchorRect.height / 2 - mh / 2;
    const top = clamp(idealTop, margin, vh - mh - margin);

    setPos({ top, left, placement });
  };

  useLayoutEffect(() => {
    if (!open || !anchorRect) return;
    // 初回は測定が必要なので rAF で1拍置く
    requestAnimationFrame(updatePosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    anchorRect?.top,
    anchorRect?.left,
    anchorRect?.width,
    anchorRect?.height,
  ]);

  useLayoutEffect(() => {
    if (!open) return;
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !anchorRect) return null;

  const style: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left }
    : { top: -9999, left: -9999 };

  return createPortal(
    <div
      ref={selfRef}
      className="kifu-forkactions-pop"
      data-placement={pos?.placement ?? "right"}
      style={style}
      role="menu"
      aria-label="分岐の操作"
      onPointerDown={(e) => {
        // StreamList の outside click で ForkMenu が閉じるのを防ぐ
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="kifu-forkactions-pop__item"
        role="menuitem"
        disabled={busy || !canUp}
        onClick={() => {
          if (busy || !canUp) return;
          onUp();
          onClose();
        }}
      >
        <ChevronUp size={16} className="kifu-forkactions-pop__icon" />
        <span className="kifu-forkactions-pop__label">上へ</span>
      </button>

      <button
        type="button"
        className="kifu-forkactions-pop__item"
        role="menuitem"
        disabled={busy || !canDown}
        onClick={() => {
          if (busy || !canDown) return;
          onDown();
          onClose();
        }}
      >
        <ChevronDown size={16} className="kifu-forkactions-pop__icon" />
        <span className="kifu-forkactions-pop__label">下へ</span>
      </button>

      <div className="kifu-forkactions-pop__divider" role="separator" />

      <button
        type="button"
        className="kifu-forkactions-pop__item kifu-forkactions-pop__item--danger"
        role="menuitem"
        disabled={busy}
        onClick={() => {
          if (busy) return;
          onDelete();
          onClose();
        }}
      >
        <Trash2 size={16} className="kifu-forkactions-pop__icon" />
        <span className="kifu-forkactions-pop__label">削除</span>
      </button>
    </div>,
    document.body,
  );
});

export default KifuForkActions;
