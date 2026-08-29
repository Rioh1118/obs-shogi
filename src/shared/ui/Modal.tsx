import { useEffect, useMemo, useRef, type ReactNode } from "react";
import "./Modal.scss";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

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

  const cardRef = useRef<HTMLDivElement | null>(null);

  // 開いたときに中へフォーカスを移す。移さないと、キーボードだけの利用者は
  // 背後の要素を辿らないとボタンに届かない。閉じたら元の場所へ返す
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const card = cardRef.current;

    const focusable = card?.querySelector<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? card)?.focus();

    return () => restoreTo?.focus?.();
  }, []);

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

  const root = document.getElementById("modal-root") ?? document.body;

  return createPortal(
    <div className={className}>
      <div
        className="modal__overlay"
        onClick={() => {
          if (!closeOnOverlay) return;
          onClose();
        }}
      >
        <div
          ref={cardRef}
          className={`modal__card modal__card--scroll-${scroll}`}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          {showCloseButton && (
            <button type="button" className="modal__close" aria-label="閉じる" onClick={onClose}>
              <X size={18} />
            </button>
          )}
          {scroll === "content" ? <div className="modal__body">{children}</div> : children}
        </div>
      </div>
    </div>,
    root,
  );
}

export default Modal;
