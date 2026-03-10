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

type Geometry = { top: number; left: number; width: number; height: number };

type InteractionType =
  | "drag"
  | "resize-n"
  | "resize-s"
  | "resize-e"
  | "resize-w"
  | "resize-ne"
  | "resize-nw"
  | "resize-se"
  | "resize-sw";

export type FloatingNoteProps = {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  title?: React.ReactNode;
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
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const activeRef = useRef<InteractionType | null>(null);
  const startRef = useRef({ mx: 0, my: 0, pt: 0, pl: 0, pw: 0, ph: 0 });

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
      setGeometry(null);
      setIsDragging(false);
    }
  }, [open, anchorEl]);

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
      const type = activeRef.current;
      if (!type) return;

      const { mx, my, pt, pl, pw, ph } = startRef.current;
      const dx = e.clientX - mx;
      const dy = e.clientY - my;
      const m = 4;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const minW = 280;
      const minH = 180;

      if (type === "drag") {
        setGeometry((g) => ({
          top: clamp(pt + dy, m, vh - ph - m),
          left: clamp(pl + dx, m, vw - pw - m),
          width: g?.width ?? pw,
          height: g?.height ?? ph,
        }));
        return;
      }

      let newTop = pt;
      let newLeft = pl;
      let newWidth = pw;
      let newHeight = ph;

      if (type.includes("e")) {
        newWidth = clamp(pw + dx, minW, vw - pl - m);
      }
      if (type.includes("w")) {
        newLeft = clamp(pl + dx, m, pl + pw - minW);
        newWidth = pl + pw - newLeft;
      }
      if (type.includes("s")) {
        newHeight = clamp(ph + dy, minH, vh - pt - m);
      }
      if (type.includes("n")) {
        newTop = clamp(pt + dy, m, pt + ph - minH);
        newHeight = pt + ph - newTop;
      }

      setGeometry({
        top: newTop,
        left: newLeft,
        width: newWidth,
        height: newHeight,
      });
    };

    const onUp = () => {
      activeRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const startInteraction = (e: React.PointerEvent, type: InteractionType) => {
    if (e.button !== 0) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    activeRef.current = type;
    startRef.current = {
      mx: e.clientX,
      my: e.clientY,
      pt: rect.top,
      pl: rect.left,
      pw: rect.width,
      ph: rect.height,
    };

    if (type === "drag") setIsDragging(true);
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
    if (geometry) {
      return {
        top: geometry.top,
        left: geometry.left,
        width: geometry.width,
        height: geometry.height,
        bottom: undefined,
        maxHeight: undefined,
      };
    }

    const w = Math.min(
      width,
      typeof window !== "undefined" ? window.innerWidth - 16 : width,
    );

    if (!anchoredPos) return { width: w };

    return {
      width: w,
      top: anchoredPos.top,
      left: anchoredPos.left,
      bottom: anchoredPos.bottom,
      maxHeight: anchoredPos.maxHeight,
    };
  }, [geometry, anchoredPos, width]);

  if (!open || !anchorEl || typeof document === "undefined") return null;
  if (!anchoredPos && !geometry) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={panelClassName}
      style={style}
      role="dialog"
      aria-modal="false"
    >
      <div className="floating-note__top-band" aria-hidden="true">
        <div
          className="floating-note__resize floating-note__resize--nw"
          onPointerDown={(e) => {
            e.stopPropagation();
            startInteraction(e, "resize-nw");
          }}
        />
        <div
          className="floating-note__resize floating-note__resize--n"
          onPointerDown={(e) => {
            e.stopPropagation();
            startInteraction(e, "resize-n");
          }}
        />
        <div
          className="floating-note__resize floating-note__resize--ne"
          onPointerDown={(e) => {
            e.stopPropagation();
            startInteraction(e, "resize-ne");
          }}
        />
      </div>

      <div className="floating-note__header">
        <div className="floating-note__title">{title}</div>

        <div
          className="floating-note__drag-area"
          onPointerDown={(e) => startInteraction(e, "drag")}
          aria-label="ドラッグして移動"
        >
          <div className="floating-note__drag-grip" aria-hidden="true" />
        </div>

        <div
          className="floating-note__header-right"
          onPointerDown={(e) => e.stopPropagation()}
        >
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

      <div
        className="floating-note__resize floating-note__resize--e"
        onPointerDown={(e) => {
          e.stopPropagation();
          startInteraction(e, "resize-e");
        }}
      />
      <div
        className="floating-note__resize floating-note__resize--w"
        onPointerDown={(e) => {
          e.stopPropagation();
          startInteraction(e, "resize-w");
        }}
      />
      <div
        className="floating-note__resize floating-note__resize--s"
        onPointerDown={(e) => {
          e.stopPropagation();
          startInteraction(e, "resize-s");
        }}
      />
      <div
        className="floating-note__resize floating-note__resize--se"
        onPointerDown={(e) => {
          e.stopPropagation();
          startInteraction(e, "resize-se");
        }}
      />
      <div
        className="floating-note__resize floating-note__resize--sw"
        onPointerDown={(e) => {
          e.stopPropagation();
          startInteraction(e, "resize-sw");
        }}
      />
    </div>,
    document.body,
  );
}
