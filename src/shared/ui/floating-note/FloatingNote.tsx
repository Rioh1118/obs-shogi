import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useOverlayLayer } from "@/shared/lib/overlayStack";
import {
  computeAnchoredPos,
  moveGeometry,
  resizeGeometry,
  type AnchoredPos,
  type Geometry,
  type ResizeEdge,
} from "./floatingGeometry";
import "./FloatingNote.scss";

/** 押している間の操作。掴んだ位置の移動か、把手の辺のリサイズ */
type Interaction = "drag" | ResizeEdge;

export type FloatingNoteProps = {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  title?: ReactNode;
  headerRight?: ReactNode;
  width?: number;
  className?: string;
  children: ReactNode;
};

type ResizeHandleProps = {
  edge: ResizeEdge;
  onStart: (e: ReactPointerEvent, interaction: Interaction) => void;
};

/** リサイズの把手。押下を親へ流さない。流すと React の親の `onPointerDown` が反応する */
function ResizeHandle({ edge, onStart }: ResizeHandleProps) {
  const handlePointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    onStart(e, edge);
  };

  return (
    <div
      className={`floating-note__resize floating-note__resize--${edge}`}
      onPointerDown={handlePointerDown}
    />
  );
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
  const isTop = useOverlayLayer(open);
  const [anchoredPos, setAnchoredPos] = useState<AnchoredPos | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const activeRef = useRef<Interaction | null>(null);
  const startRef = useRef({ x: 0, y: 0, rect: { top: 0, left: 0, width: 0, height: 0 } });

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

  // 重なりの順序に載る。載せないと、上のモーダルを Escape で閉じたとき
  // 同じイベントがここまで届いて付箋も一緒に閉じる
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTop()) return;
      e.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, isTop]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const active = activeRef.current;
      if (!active) return;

      const { x, y, rect } = startRef.current;
      const offset = { dx: e.clientX - x, dy: e.clientY - y };
      setGeometry(
        active === "drag" ? moveGeometry(rect, offset) : resizeGeometry(rect, active, offset),
      );
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

  const startInteraction = (e: ReactPointerEvent, interaction: Interaction) => {
    if (e.button !== 0) return;

    const panel = panelRef.current;
    if (!panel) return;

    const { top, left, width, height } = panel.getBoundingClientRect();
    activeRef.current = interaction;
    startRef.current = { x: e.clientX, y: e.clientY, rect: { top, left, width, height } };

    if (interaction === "drag") setIsDragging(true);
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

    const w = Math.min(width, typeof window !== "undefined" ? window.innerWidth - 16 : width);

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
    <div ref={panelRef} className={panelClassName} style={style} role="dialog" aria-modal="false">
      <div className="floating-note__top-band" aria-hidden="true">
        <ResizeHandle edge="nw" onStart={startInteraction} />
        <ResizeHandle edge="n" onStart={startInteraction} />
        <ResizeHandle edge="ne" onStart={startInteraction} />
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

        <div className="floating-note__header-right" onPointerDown={(e) => e.stopPropagation()}>
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

      <ResizeHandle edge="e" onStart={startInteraction} />
      <ResizeHandle edge="w" onStart={startInteraction} />
      <ResizeHandle edge="s" onStart={startInteraction} />
      <ResizeHandle edge="se" onStart={startInteraction} />
      <ResizeHandle edge="sw" onStart={startInteraction} />
    </div>,
    document.body,
  );
}
