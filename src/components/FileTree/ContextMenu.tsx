import { type ContextMenuItem } from "@/types";
import { useEffect, useRef } from "react";

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  minWidth?: number;
};

function ContextMenu({
  x,
  y,
  items,
  onClose,
  minWidth = 180,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

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
      if (e.key === "Escape") {
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
  }, [onClose]);

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
        left: x,
        top: y,
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
          className={[
            "context-menu__item",
            item.danger ? "context-menu__item--danger" : "",
          ].join(" ")}
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
