import type React from "react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import "./KifuMoveActions.scss";

type Props = {
  open: boolean;
  busy: boolean;
  anchorRect: DOMRect | null;

  te: number;
  onClose: () => void;
  onDeleteFromHere: (te: number) => void;
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

const KifuMoveActions = memo(function KifuMoveActions({
  open,
  busy,
  anchorRect,
  te,
  onClose,
  onDeleteFromHere,
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

    let placement: "right" | "left" = "right";
    let left = anchorRect.right + gap;

    if (left + mw + margin > vw) {
      placement = "left";
      left = anchorRect.left - mw - gap;
    }
    left = clamp(left, margin, vw - mw - margin);

    const idealTop = anchorRect.top + anchorRect.height / 2 - mh / 2;
    const top = clamp(idealTop, margin, vh - mh - margin);

    setPos({ top, left, placement });
  };

  useLayoutEffect(() => {
    if (!open || !anchorRect) return;
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
      className="kifu-moveactions-pop"
      data-placement={pos?.placement ?? "right"}
      style={style}
      role="menu"
      aria-label={`${te}手目の操作`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="kifu-moveactions-pop__item kifu-moveactions-pop__item--danger"
        role="menuitem"
        disabled={busy || te === 0}
        onClick={() => {
          if (busy || te === 0) return;
          onDeleteFromHere(te);
          onClose();
        }}
      >
        <Trash2 size={16} className="kifu-moveactions-pop__icon" />
        <span className="kifu-moveactions-pop__label">削除</span>
      </button>
    </div>,
    document.body,
  );
});

export default KifuMoveActions;
