import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./FloatingNote.scss";

type Placement = "top" | "bottom";

type AnchoredPos = {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  placement: Placement;
};

export type FloatingNoteProps = {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  title?: string;
  headerRight?: React.ReactNode;
  width?: number;
  className?: string;
  children: React.ReactNode;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function computeAnchoredPos(
  anchorEl: HTMLElement,
  width: number,
): AnchoredPos {
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const gap = 8;

  // Clamp width to viewport
  const w = Math.min(width, vw - margin * 2);
  const left = clamp(rect.left, margin, Math.max(margin, vw - w - margin));

  const spaceBelow = vh - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  const placeBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;

  if (placeBelow) {
    return {
      left,
      top: rect.bottom + gap,
      maxHeight: Math.max(140, spaceBelow),
      placement: "bottom",
    };
  }

  return {
    left,
    bottom: vh - rect.top + gap,
    maxHeight: Math.max(140, spaceAbove),
    placement: "top",
  };
}

export default function FloatingNote({
  open,
  anchorEl,
  onClose,
  title,
  headerRight,
  width = 400,
  className,
  children,
}: FloatingNoteProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchoredPos, setAnchoredPos] = useState<AnchoredPos | null>(null);

  const [dragPos, setDragPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, pt: 0, pl: 0 });
  const [isDragging, setIsDragging] = useState(false);

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const update = () => setAnchoredPos(computeAnchoredPos(anchorEl, width));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorEl, width]);

  useEffect(() => {
    if (open) {
      setDragPos(null);
      setIsDragging(false);
    }
  }, [open, anchorEl]);

  // Escape only — no outside-click close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const { mx, my, pt, pl } = dragStartRef.current;
      const panel = panelRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = panel?.offsetWidth ?? width;
      const ph = panel?.offsetHeight ?? 300;
      const m = 4;
      setDragPos({
        top: clamp(pt + e.clientY - my, m, vh - ph - m),
        left: clamp(pl + e.clientX - mx, m, vw - pw - m),
      });
    };
    const onUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [width]);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      pt: rect.top,
      pl: rect.left,
    };
    e.preventDefault();
  };

  const panelClassName = useMemo(() => {
    return [
      "floating-note",
      `floating-note--${anchoredPos?.placement ?? "bottom"}`,
      isDragging ? "floating-note--dragging" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [anchoredPos?.placement, isDragging, className]);

  const effectiveWidth = Math.min(
    width,
    typeof window !== "undefined" ? window.innerWidth - 16 : width,
  );

  const style = useMemo(() => {
    if (dragPos) {
      const vh = window.innerHeight;
      return {
        width: effectiveWidth,
        top: dragPos.top,
        left: dragPos.left,
        bottom: undefined,
        maxHeight: Math.max(140, vh - dragPos.top - 8),
      };
    }
    if (!anchoredPos) return { width: effectiveWidth };
    return {
      width: effectiveWidth,
      top: anchoredPos.top,
      left: anchoredPos.left,
      bottom: anchoredPos.bottom,
      maxHeight: anchoredPos.maxHeight,
    };
  }, [dragPos, anchoredPos, effectiveWidth]);

  if (!open || !anchorEl || typeof document === "undefined") return null;
  if (!anchoredPos && !dragPos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={panelClassName}
      style={style}
      role="dialog"
      aria-modal="false"
    >
      <div
        className="floating-note__header"
        onPointerDown={onHeaderPointerDown}
      >
        <div className="floating-note__title">{title}</div>
        <div className="floating-note__header-right">
          {headerRight}
          <button
            type="button"
            className="floating-note__close"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
      </div>
      <div className="floating-note__body">{children}</div>
    </div>,
    document.body,
  );
}
