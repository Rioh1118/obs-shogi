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

function computeAnchoredPos(anchorEl: HTMLElement, width: number): AnchoredPos {
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const gap = 8;

  const left = clamp(rect.left, margin, Math.max(margin, vw - width - margin));

  const spaceBelow = vh - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;
  const placeBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;

  if (placeBelow) {
    return {
      left,
      top: rect.bottom + gap,
      maxHeight: Math.max(160, spaceBelow),
      placement: "bottom",
    };
  }

  return {
    left,
    bottom: vh - rect.top + gap,
    maxHeight: Math.max(160, spaceAbove),
    placement: "top",
  };
}

export default function FloatingNote({
  open,
  anchorEl,
  onClose,
  title,
  headerRight,
  width = 420,
  className,
  children,
}: FloatingNoteProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchoredPos, setAnchoredPos] = useState<AnchoredPos | null>(null);

  // Drag: absolute position override (top/left, set once drag starts)
  const [dragPos, setDragPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, pt: 0, pl: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Recompute anchor position
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

  // Reset drag when reopened
  useEffect(() => {
    if (open) {
      setDragPos(null);
      setIsDragging(false);
    }
  }, [open, anchorEl]);

  // Outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      if (anchorEl && path.includes(anchorEl)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchorEl, onClose]);

  // Global pointer events for drag
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const { mx, my, pt, pl } = dragStartRef.current;
      const panel = panelRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = panel?.offsetWidth ?? width;
      const ph = panel?.offsetHeight ?? 320;
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

  const style = useMemo(() => {
    if (dragPos) {
      const vh = window.innerHeight;
      const ph = panelRef.current?.offsetHeight ?? 320;
      return {
        width,
        top: dragPos.top,
        left: dragPos.left,
        bottom: undefined,
        maxHeight: Math.max(160, vh - dragPos.top - 8),
        minHeight: Math.min(ph, 160),
      };
    }
    if (!anchoredPos) return { width };
    return {
      width,
      top: anchoredPos.top,
      left: anchoredPos.left,
      bottom: anchoredPos.bottom,
      maxHeight: anchoredPos.maxHeight,
    };
  }, [dragPos, anchoredPos, width]);

  if (!open || !anchorEl || typeof document === "undefined") return null;
  if (!anchoredPos && !dragPos) return null;

  return createPortal(
    <div ref={panelRef} className={panelClassName} style={style} role="dialog" aria-modal="false">
      <div
        className="floating-note__header"
        onPointerDown={onHeaderPointerDown}
      >
        <div className="floating-note__title">{title}</div>
        {headerRight != null && (
          <div className="floating-note__header-right">{headerRight}</div>
        )}
      </div>
      <div className="floating-note__body">{children}</div>
    </div>,
    document.body,
  );
}
