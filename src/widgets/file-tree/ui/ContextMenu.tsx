import { useOverlayLayer } from "@/shared/lib/overlayStack";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { keepInViewport } from "@/shared/lib/keepInViewport";
import "./ContextMenu.scss";

type ContextMenuItem = {
  id?: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void | Promise<void>;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  minWidth?: number;
};

function ContextMenu({ x, y, items, onClose, minWidth = 180 }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 開いている間だけマウントされる。Escape は最上位の1枚だけ → `overlayStack`
  const isTop = useOverlayLayer(true);
  // 自分の大きさが決まってからでないと丸められないので、まず開いた場所へ出す
  const [box, setBox] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    setBox(keepInViewport({ x, y }, { width: el.offsetWidth, height: el.offsetHeight }));
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const el = menuRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && !el.contains(target)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTop()) {
        onClose();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    window.addEventListener("keydown", handleKeyDown);

    menuRef.current?.focus();

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, isTop]);

  const handleItemClick = async (item: ContextMenuItem) => {
    if (item.disabled) return;
    try {
      await item.onClick();
    } finally {
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{
        position: "fixed",
        left: box.left,
        top: box.top,
        minWidth,
        zIndex: 9999,
      }}
      tabIndex={-1}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id ?? `${item.label}-${index}`}
          type="button"
          className={["context-menu__item", item.danger ? "context-menu__item--danger" : ""].join(
            " ",
          )}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => handleItemClick(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default ContextMenu;
