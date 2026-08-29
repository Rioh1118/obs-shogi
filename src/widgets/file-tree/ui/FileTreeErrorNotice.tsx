import { describeFsError, fsErrorPresentation, type FsError } from "@/entities/file-tree/api/error";
import "./FileTreeErrorNotice.scss";

interface Props {
  error: FsError;
  onRetry: () => void;
  onDismiss?: () => void;
  isRetrying?: boolean;
  /**
   * 読み直しでは直らない失敗のときに出す逃げ道。
   * 何をすれば直るかは失敗ごとに違うので、動作ごと受け取る（ADR-0004）。
   */
  fallback?: { label: string; run: () => void };
}

/**
 * ファイル操作とツリー取得の失敗を出す。
 *
 * 段は `fsErrorPresentation` が決める。読み直しても直らない失敗に再読み込みを
 * 出すと、押しても何も変わらないので利用者は押し続ける。
 *
 * 復帰路は読み直しの1本だけ。失敗した操作の内容は state に残らないので
 * （`already_exists` のみ `conflict` として保持される）、同じ操作をやり直すことはできない。
 */
export default function FileTreeErrorNotice({
  error,
  onRetry,
  onDismiss,
  isRetrying,
  fallback,
}: Props) {
  const { tier, showMessage } = fsErrorPresentation(error.code);

  return (
    <div className={`ftError ftError--${tier}`} role="alert">
      <p className="ftError__lead">{describeFsError(error.code)}</p>
      {showMessage && <p className="ftError__hint">{error.message}</p>}
      {error.path && <p className="ftError__path">{error.path}</p>}

      {/* 本文に出した内容を畳んでもう一度見せても、開く手間が増えるだけ */}
      {!showMessage && (
        <details className="ftError__detail">
          <summary>技術的な詳細</summary>
          <pre className="ftError__raw">
            {error.code}
            {"\n"}
            {error.message}
          </pre>
        </details>
      )}

      <div className="ftError__actions">
        {onDismiss && (
          <button type="button" className="ftError__btn" onClick={onDismiss} disabled={isRetrying}>
            閉じる
          </button>
        )}
        {tier !== "warning" && fallback && (
          <button
            type="button"
            className="ftError__btn ftError__btn--primary"
            onClick={fallback.run}
          >
            {fallback.label}
          </button>
        )}
        {tier === "warning" && (
          <button
            type="button"
            className="ftError__btn ftError__btn--primary"
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? "読み込み中..." : "再読み込み"}
          </button>
        )}
      </div>
    </div>
  );
}
