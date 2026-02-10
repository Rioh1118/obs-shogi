import { useEffect, useMemo, type ReactNode } from "react";
import "./Modal.scss";
import { X } from "lucide-react";

type ModalTheme = "light" | "dark";
type ModalVariant = "dialog" | "workspace";
type ModalSize = "sm" | "md" | "lg" | "xl" | "full";
type ModalChrome = "card" | "none";
type ModalPadding = "none" | "sm" | "md";
type ModalScroll = "card" | "content" | "none";

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  theme?: ModalTheme;
  variant?: ModalVariant;
  size?: ModalSize;
  chrome?: ModalChrome;
  padding?: ModalPadding;
  scroll?: ModalScroll;

  closeOnEsc?: boolean;
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
}

function Modal({
  children,
  onClose,

  theme = "light",
  variant = "dialog",
  size = "md",
  chrome = "card",
  padding = "md",
  scroll = "none",

  closeOnEsc = true,
  closeOnOverlay = true,
  showCloseButton = false,
}: ModalProps) {
  const className = useMemo(() => {
    return [
      "modal",
      `modal--${theme}`,
      `modal--${variant}`,
      `modal--size-${size}`,
      `modal--chrome-${chrome}`,
      `modal--pad-${padding}`,
    ].join(" ");
  }, [theme, variant, size, chrome, padding]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const isComposing = e.isComposing;
      if (e.key === "Escape" && closeOnEsc && !isComposing) {
        e.preventDefault();
        onClose();
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [closeOnEsc, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className={className}>
      <div
        className="modal__overlay"
        onClick={() => {
          if (!closeOnOverlay) return;
          onClose();
        }}
      >
        <div
          className={`modal__card modal__card--scroll-${scroll}`}
          onClick={(e) => e.stopPropagation()}
        >
          {showCloseButton && (
            <button
              type="button"
              className="modal__close"
              aria-label="閉じる"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          )}
          {scroll === "content" ? (
            <div className="modal__body">{children}</div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}

export default Modal;
