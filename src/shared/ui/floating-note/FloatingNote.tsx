import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./FloatingNote.scss";

type Placement = "top" | "bottom";

type Position = {
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
  width?: number;
  className?: string;
  children: React.ReactNode;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function computePosition(anchorEl: HTMLElement, width: number): Position {
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const margin = 12;
  const gap = 10;

  const left = clamp(rect.left, margin, vw - width - margin);

  const spaceBelow = vh - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const placeBelow = spaceBelow >= 260 || spaceBelow >= spaceAbove;

  if (placeBelow) {
    return {
      left,
      top: rect.bottom + gap,
      maxHeight: Math.max(180, vh - rect.bottom - gap - margin),
      placement: "bottom",
    };
  }

  return {
    left,
    bottom: vh - rect.top + gap,
    maxHeight: Math.max(180, rect.top - gap - margin),
    placement: "top",
  };
}

export default function FloatingNote({
  open,
  anchorEl,
  onClose,
  title,
  width = 420,
  className,
  children,
}: FloatingNoteProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const panelClassName = useMemo(() => {
    return [
      "floating-note",
      position ? `floating-note--${position.placement}` : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [position, className]);

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;

    const update = () => {
      setPosition(computePosition(anchorEl, width));
    };

    update();

    const onScroll = () => update();
    const onResize = () => update();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, anchorEl, width]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      const panelEl = panelRef.current;

      if (panelEl && path.includes(panelEl)) return;
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

  if (!open || !anchorEl || !position || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className={panelClassName}
      style={{
        width,
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        maxHeight: position.maxHeight,
      }}
      role="dialog"
      aria-modal="false"
    >
      {title ? (
        <div className="floating-note__header">
          <div className="floating-note__title">{title}</div>
        </div>
      ) : null}

      <div className="floating-note__body">{children}</div>
    </div>,
    document.body,
  );
}
