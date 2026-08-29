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
 * 実行する側を `danger` にする。ただし**色だけに頼らない**。
 * 文言を操作名（「削除する」/「キャンセル」）にしてあるので、色を見分けられない
 * 利用者にも、どちらが取り消せない側かが読める。
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
          <Button tone="danger" onClick={onConfirm} isLoading={isLoading}>
            {isLoading ? "削除中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
