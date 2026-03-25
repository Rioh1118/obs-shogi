import { createPortal } from "react-dom";
import { Download, RefreshCw, X } from "lucide-react";
import { useUpdater } from "../lib/useUpdater";
import "./UpdaterScreen.scss";

export default function UpdaterScreen() {
  const { status, downloadAndInstall, restart, dismiss } = useUpdater();

  if (status.phase === "idle" || status.phase === "checking") {
    return null;
  }

  const version = status.phase === "available" ? status.update.version : null;

  return createPortal(
    <div className="updater-overlay" role="dialog" aria-modal="true" aria-label="アップデート">
      <div className="updater-card">
        {/* Header */}
        <div className="updater-card__header">
          <div className="updater-card__icon" aria-hidden="true">
            <RefreshCw size={18} strokeWidth={1.8} />
          </div>
          <div className="updater-card__heading">
            {status.phase === "error"
              ? "更新に失敗しました"
              : status.phase === "ready"
                ? "更新の準備ができました"
                : status.phase === "downloading"
                  ? "ダウンロード中…"
                  : "新しいバージョンが利用可能"}
          </div>
          {(status.phase === "available" || status.phase === "error") && (
            <button
              type="button"
              className="updater-card__dismiss"
              onClick={dismiss}
              aria-label="閉じる"
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="updater-card__body">
          {status.phase === "available" && version && (
            <p className="updater-card__version">
              バージョン <span className="updater-card__version-tag">v{version}</span>{" "}
              が公開されています
            </p>
          )}

          {status.phase === "downloading" && (
            <div className="updater-card__progress-wrap">
              <div className="updater-card__progress-bar">
                <div
                  className="updater-card__progress-fill"
                  style={{ width: `${status.progress}%` }}
                />
              </div>
              <span className="updater-card__progress-label">{status.progress}%</span>
            </div>
          )}

          {status.phase === "ready" && (
            <p className="updater-card__note">再起動してアップデートを適用します</p>
          )}

          {status.phase === "error" && <p className="updater-card__error">{status.message}</p>}
        </div>

        {/* Actions */}
        <div className="updater-card__actions">
          {status.phase === "available" && (
            <>
              <button
                type="button"
                className="updater-card__btn updater-card__btn--secondary"
                onClick={dismiss}
              >
                後で
              </button>
              <button
                type="button"
                className="updater-card__btn updater-card__btn--primary"
                onClick={() => void downloadAndInstall()}
              >
                <Download size={13} strokeWidth={2.2} />
                今すぐ更新
              </button>
            </>
          )}
          {status.phase === "ready" && (
            <button
              type="button"
              className="updater-card__btn updater-card__btn--primary"
              onClick={() => void restart()}
            >
              <RefreshCw size={13} strokeWidth={2.2} />
              再起動して適用
            </button>
          )}
          {status.phase === "error" && (
            <button
              type="button"
              className="updater-card__btn updater-card__btn--secondary"
              onClick={dismiss}
            >
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
