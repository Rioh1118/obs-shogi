import { describeFsError, type FsError } from "@/entities/file-tree/api/error";
import "./FileTreeErrorNotice.scss";

interface Props {
  error: FsError;
  onRetry: () => void;
  onDismiss?: () => void;
  isRetrying?: boolean;
}

/**
 * ファイル操作とツリー取得の失敗を出す。
 *
 * 段は「再試行で直る」（ADR-0004）。ファイルシステムの失敗は一時的なものが
 * ありうるので、同じ操作をもう一度で直る見込みがある。復帰路は再読込のみで、
 * 失敗した操作そのものはやり直さない。何が失敗したかは呼び出し元しか知らない。
 */
export default function FileTreeErrorNotice({ error, onRetry, onDismiss, isRetrying }: Props) {
  return (
    <div className="ftError" role="alert">
      <p className="ftError__lead">{describeFsError(error.code)}</p>
      {error.path && <p className="ftError__path">{error.path}</p>}

      <details className="ftError__detail">
        <summary>技術的な詳細</summary>
        <pre className="ftError__raw">
          {error.code}
          {"\n"}
          {error.message}
          {error.cause ? `\n${error.cause}` : ""}
        </pre>
      </details>

      <div className="ftError__actions">
        {onDismiss && (
          <button type="button" className="ftError__btn" onClick={onDismiss} disabled={isRetrying}>
            閉じる
          </button>
        )}
        <button
          type="button"
          className="ftError__btn ftError__btn--primary"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? "読み込み中..." : "再読み込み"}
        </button>
      </div>
    </div>
  );
}
