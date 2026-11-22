import { memo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useBesidePlacement } from "./useBesidePlacement";
import { Trash2 } from "lucide-react";
import "./KifuMenu.scss";

type Props = {
  open: boolean;
  busy: boolean;
  anchorRect: DOMRect | null;

  te: number;
  onClose: () => void;
  onDeleteFromHere: (te: number) => void;
};

const KifuMoveActions = memo(function KifuMoveActions({
  open,
  busy,
  anchorRect,
  te,
  onClose,
  onDeleteFromHere,
}: Props) {
  const { selfRef, placement } = useBesidePlacement(open, anchorRect);

  const handleDelete = () => {
    if (busy || te === 0) return;
    onDeleteFromHere(te);
    onClose();
  };

  if (!open || !anchorRect) return null;

  const style: CSSProperties = placement
    ? { top: placement.top, left: placement.left }
    : { top: -9999, left: -9999 };

  return createPortal(
    <div
      ref={selfRef}
      className="kifu-menu"
      style={style}
      role="menu"
      aria-label={`${te}手目の操作`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="kifu-menu__item kifu-menu__item--danger"
        role="menuitem"
        disabled={busy || te === 0}
        onClick={handleDelete}
      >
        <Trash2 size={16} aria-hidden="true" />
        <span>削除</span>
      </button>
    </div>,
    document.body,
  );
});

export default KifuMoveActions;
