import type React from "react";
import { memo } from "react";
import { createPortal } from "react-dom";
import { useBesidePlacement } from "./useBesidePlacement";
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
  const { selfRef, placement } = useBesidePlacement(open, anchorRect);

  if (!open || !anchorRect) return null;

  const style: React.CSSProperties = placement
    ? { top: placement.top, left: placement.left }
    : { top: -9999, left: -9999 };

  return createPortal(
    <div
      ref={selfRef}
      className="kifu-forkactions-pop"
      data-placement={placement?.side ?? "right"}
      style={style}
      role="menu"
      aria-label="分岐の操作"
      onPointerDown={(e) => {
        // `KifuStreamList` が document で受ける外側の押下へ届かせない。届くと分岐メニューが閉じる
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
