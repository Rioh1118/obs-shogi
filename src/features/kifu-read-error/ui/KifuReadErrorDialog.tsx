import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, RefreshCw, X } from "lucide-react";
import Modal from "@/shared/ui/Modal";
import type { FsError } from "@/entities/file-tree/api/error";
import "./KifuReadErrorDialog.scss";

type Props = {
  error: FsError | null;
  onRetry: () => void;
  onDismiss: () => void;
};

function buildClipboardText(error: FsError): string {
  const lines: string[] = [
    `[棋譜読み込みエラー]`,
    `メッセージ: ${error.message}`,
  ];
  if (error.path) lines.push(`ファイル: ${error.path}`);
  if (error.cause) lines.push(`\n詳細:\n${error.cause}`);
  return lines.join("\n");
}

export function KifuReadErrorDialog({ error, onRetry, onDismiss }: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!error) return null;

  const hasDetail = !!error.cause;
  const fileName = error.path
    ? error.path.split("/").pop() ?? error.path
    : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildClipboardText(error));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const handleRetry = () => {
    onDismiss();
    onRetry();
  };

  return (
    <Modal
      onClose={onDismiss}
      theme="light"
      variant="dialog"
      size="sm"
      scroll="content"
      closeOnEsc
      closeOnOverlay
    >
      <div className="kifu-read-error">
        <header className="kifu-read-error__header">
          <div className="kifu-read-error__iconWrap" aria-hidden="true">
            <AlertTriangle size={18} />
          </div>
          <div className="kifu-read-error__headingBlock">
            <h2 className="kifu-read-error__title">棋譜を開けませんでした</h2>
            {fileName && (
              <p className="kifu-read-error__file">{fileName}</p>
            )}
          </div>
          <button
            type="button"
            className="kifu-read-error__closeBtn"
            onClick={onDismiss}
            aria-label="閉じる"
          >
            <X size={16} />
          </button>
        </header>

        {/* Layer 2: actionable reason */}
        <div className="kifu-read-error__reasonBox">
          <p className="kifu-read-error__reason">{error.message}</p>
          {error.path && (
            <p className="kifu-read-error__path">{error.path}</p>
          )}
        </div>

        {/* Layer 3: technical detail (collapsible) */}
        {hasDetail && (
          <div className="kifu-read-error__detail">
            <button
              type="button"
              className="kifu-read-error__detailToggle"
              onClick={() => setDetailOpen((v) => !v)}
            >
              {detailOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              技術的な詳細
            </button>
            {detailOpen && (
              <pre className="kifu-read-error__detailBody">{error.cause}</pre>
            )}
          </div>
        )}

        <div className="kifu-read-error__actions">
          <div className="kifu-read-error__actionsLeft">
            <button
              type="button"
              className="kifu-read-error__btn kifu-read-error__btn--ghost"
              onClick={() => void handleCopy()}
            >
              <Copy size={13} />
              {copied ? "コピーしました" : "エラーをコピー"}
            </button>
          </div>
          <div className="kifu-read-error__actionsRight">
            <button
              type="button"
              className="kifu-read-error__btn kifu-read-error__btn--ghost"
              onClick={onDismiss}
            >
              閉じる
            </button>
            <button
              type="button"
              className="kifu-read-error__btn kifu-read-error__btn--primary"
              onClick={handleRetry}
            >
              <RefreshCw size={13} />
              再試行
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
