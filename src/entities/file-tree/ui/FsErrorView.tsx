import type { ReactNode } from "react";
import { describeFsError, fsErrorTier, type FsError } from "@/entities/file-tree/api/error";
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
 * 利用者に見せる文は `describeFsError` が `code` から作る。`message` は開発者向けの
 * ログなので、`cause` と一緒に畳んだ中へ置く。
 */
export default function FsErrorView({ error, actions }: Props) {
  const tier = fsErrorTier(error.code);
  const detail = [error.code, error.message, error.cause].filter(Boolean).join("\n");

  return (
    <div className={`fsError fsError--${tier}`}>
      {/*
        読み上げるのは何が起きたかだけ。ボタンと畳んだログまで包むと、
        読み直し中にボタンの文言が変わるたびに全文が読み上げ直される
      */}
      <div className="fsError__message" role="alert">
        <p className="fsError__lead">{describeFsError(error.code)}</p>
        {error.path && <p className="fsError__path">{error.path}</p>}
      </div>

      <details className="fsError__detail">
        <summary>技術的な詳細</summary>
        <pre className="fsError__raw">{detail}</pre>
      </details>

      {actions && <div className="fsError__actions">{actions}</div>}
    </div>
  );
}
