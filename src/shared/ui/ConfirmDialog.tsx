import Button from "@/shared/ui/Button/Button";
import Modal from "@/shared/ui/Modal";
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

/**
 * 取り消せない操作の確認（ADR-0004）。
 *
 * 実行する側を `danger` にして、押し分けを見た目で伝える。
 * 同じ形のボタンを2つ並べると、どちらが破壊的かが色でしか分からなくなる。
 */
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
    <Modal
      onClose={onCancel}
      label={title}
      theme="dark"
      size="sm"
      padding="none"
      scroll="none"
      closeOnEsc={!isLoading}
      closeOnOverlay={!isLoading}
    >
      <div className="confirm-dialog">
        <p className="confirm-dialog__title">{title}</p>
        {subtitle && <p className="confirm-dialog__sub">{subtitle}</p>}
        <div className="confirm-dialog__actions">
          <Button onClick={onCancel} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button tone="danger" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "削除中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
