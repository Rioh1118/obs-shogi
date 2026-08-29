import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "@/shared/ui/Modal";
import Button from "@/shared/ui/Button/Button";
import { FsErrorView, type FsError } from "@/entities/file-tree";
import "./KifuReadErrorDialog.scss";

type Props = {
  error: FsError | null;
  onDismiss: () => void;
};

function buildClipboardText(error: FsError): string {
  const lines = [`[棋譜読み込みエラー]`, `code: ${error.code}`, `message: ${error.message}`];
  if (error.path) lines.push(`file: ${error.path}`);
  if (error.cause) lines.push(`\ncause:\n${error.cause}`);
  return lines.join("\n");
}

/**
 * 棋譜を開けなかったことを伝える。
 *
 * 失敗そのものの見せ方は `FsErrorView` が持つ。ここが足すのは「棋譜を開こうとして
 * 失敗した」という文脈だけ。`io` や `permission_denied` は code だけでは
 * 何をしていて失敗したのかが分からない。
 */
export function KifuReadErrorDialog({ error, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (error) setCopied(false);
  }, [error]);

  if (!error) return null;

  const fileName = error.path ? (error.path.split(/[/\\]/).pop() ?? error.path) : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildClipboardText(error));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では、畳んだ詳細から手で拾える
    }
  };

  return (
    <Modal
      onClose={onDismiss}
      label="棋譜を開けませんでした"
      theme="dark"
      variant="dialog"
      size="sm"
      padding="none"
      scroll="content"
      closeOnEsc
      closeOnOverlay
    >
      <div className="kifuReadError">
        <header className="kifuReadError__header">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <h2 className="kifuReadError__title">棋譜を開けませんでした</h2>
            {fileName && <p className="kifuReadError__file">{fileName}</p>}
          </div>
        </header>

        <FsErrorView
          error={error}
          actions={
            <>
              <Button onClick={() => void handleCopy()}>
                {copied ? "コピーしました" : "エラーをコピー"}
              </Button>
              <Button tone="primary" onClick={onDismiss}>
                閉じる
              </Button>
            </>
          }
        />
      </div>
    </Modal>
  );
}
