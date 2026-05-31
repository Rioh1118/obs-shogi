import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import Button from "@/shared/ui/Form/Button";
import "./ConfirmDialog.scss";

interface ConfirmDialogProps {
  title: string;
  subtitle?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  subtitle,
  confirmLabel = "削除する",
  cancelLabel = "キャンセル",
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const getActionButtons = (): HTMLButtonElement[] => {
    const dialog = dialogRef.current;
    if (!dialog) return [];
    return Array.from(
      dialog.querySelectorAll<HTMLButtonElement>(".confirm-dialog__actions button"),
    );
  };

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const buttons = getActionButtons();
    buttons[0]?.focus();

    return () => {
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) {
        prev.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.isComposing) return;
      if (e.key !== "Escape") return;

      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;

    const buttons = getActionButtons().filter((b) => !b.disabled);
    if (buttons.length === 0) {
      e.preventDefault();
      return;
    }

    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || !dialogRef.current?.contains(active)) {
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

  return createPortal(
    <div
      className="confirm-dialog-overlay"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <p id={titleId} className="confirm-dialog__title">
          {title}
        </p>
        {subtitle && (
          <p id={descId} className="confirm-dialog__sub">
            {subtitle}
          </p>
        )}
        <div className="confirm-dialog__actions">
          <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant="ghost" onClick={onConfirm} disabled={isLoading}>
            <span className="confirm-dialog__danger-label">
              {isLoading ? "削除中..." : confirmLabel}
            </span>
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
