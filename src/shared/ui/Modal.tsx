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

  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

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
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const card = cardRef.current;
    if (card) {
      const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      if (first) {
        first.focus();
      } else {
        card.setAttribute("tabindex", "-1");
        card.focus();
      }
    }

    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) {
        prev.focus();
      }
    };
  }, []);

  const onCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;

    const card = cardRef.current;
    if (!card) return;

    const focusables = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
    );

    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey) {
      if (active === first || !card.contains(active)) {
        e.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

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
          aria-label={ariaLabelledBy ? undefined : ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onCardKeyDown}
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
