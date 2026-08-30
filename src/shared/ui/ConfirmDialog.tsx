import Button from "@/shared/ui/Button/Button";
import Modal from "@/shared/ui/Modal";
import "./ConfirmDialog.scss";

interface ConfirmDialogProps {
  title: string;
  subtitle?: string;
  /**
   * 実行しようとして失敗した理由。
   *
   * **`subtitle` に連結しない。** 同じ位置・同じ字送り・同じ薄いグレーの段落が
   * 少し長くなるだけになり、押した直後にボタンへ向いている注意には何も届かない。
   * 支援技術も読まない（タイトルは変わらないので `label` は動かない）。
   */
  error?: string;
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
  error,
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
        {/* 領域は常設する（空でも DOM に置く）。中身と同時に入れると VoiceOver が
            live region の変化として読まない */}
        <div className="confirm-dialog__error" role="alert">
          {error && (
            <>
              <span className="confirm-dialog__errorHead">実行できませんでした。</span>
              <span className="confirm-dialog__errorCause">{error}</span>
              <span className="confirm-dialog__errorHint">
                もう一度押すとやり直します。ファイルが書き込めるかを確かめてください。
              </span>
            </>
          )}
        </div>
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
