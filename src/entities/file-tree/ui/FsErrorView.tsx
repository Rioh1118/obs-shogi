import type { ReactNode } from "react";
import { describeFsError, fsErrorPresentation, type FsError } from "@/entities/file-tree/api/error";
import "./FsErrorView.scss";

interface Props {
  error: FsError;
  /**
   * 何を出すかは失敗ごとに違うので、呼び出し側が決める（ADR-0004）。
   * 読み直しても直らない失敗に「再試行」を出すと、押しても何も起きない。
   */
  actions?: ReactNode;
}

/**
 * `FsError` を利用者に見せる。ファイル操作の失敗も棋譜の読み込み失敗も同じ形で出す。
 *
 * `message` を本文に出すかは `fsErrorPresentation` が決める。
 * 検証の失敗は空・ドット・パス区切り・NUL を1つの `code` に潰しているため、
 * 何を直せばよいかを持っているのは `message` だけになる。
 */
export default function FsErrorView({ error, actions }: Props) {
  const { tier, showMessage } = fsErrorPresentation(error.code);

  // 本文に出していないものだけを畳む。同じ内容を二度見せても開く手間が増えるだけ
  const detail = [error.code, showMessage ? null : error.message, error.cause]
    .filter(Boolean)
    .join("\n");
  const hasDetail = detail !== error.code;

  return (
    <div className={`fsError fsError--${tier}`} role="alert">
      <p className="fsError__lead">{describeFsError(error.code)}</p>
      {showMessage && <p className="fsError__hint">{error.message}</p>}
      {error.path && <p className="fsError__path">{error.path}</p>}

      {hasDetail && (
        <details className="fsError__detail">
          <summary>技術的な詳細</summary>
          <pre className="fsError__raw">{detail}</pre>
        </details>
      )}

      {actions && <div className="fsError__actions">{actions}</div>}
    </div>
  );
}
