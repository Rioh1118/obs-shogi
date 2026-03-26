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
  return (
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog__title">{title}</p>
        {subtitle && <p className="confirm-dialog__sub">{subtitle}</p>}
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
    </div>
  );
}
