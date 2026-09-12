import { createPortal } from "react-dom";
import { Download, RefreshCw, X } from "lucide-react";
import { useUpdater } from "@/entities/updater";
import type { UpdaterFailure, UpdaterStatus } from "@/entities/updater";
import "./UpdaterScreen.scss";
import Button from "@/shared/ui/Button/Button";

/**
 * 失敗の見出しと、次に何をすればよいか。
 *
 * **例外の文字列を見出しにしない。** 内部の語がそのまま利用者に届く（ADR-0004）。
 * どこまで進んでいたかは `stage` が持っているので、綴りを読む必要はない。
 *
 * **`install` の警告を弱めない。** macOS の入替は旧バンドルを退避してから
 * 新しいものを置くので、その間に落ちるとアプリの実体が残らないことがある。
 * 走っているプロセスは生きているが、閉じると起動できなくなる。
 */
function failureText(failure: UpdaterFailure): {
  heading: string;
  hint: string;
} {
  if (failure.stage === "download") {
    return {
      heading: "更新を取得できませんでした",
      hint: "通信を確かめて、もう一度お試しください。アプリはそのまま使えます。",
    };
  }
  return {
    heading: "更新を適用できませんでした",
    hint: "このまま終了すると起動できなくなることがあります。閉じる前に、配布元から最新版を入れ直してください。",
  };
}

/** 描く段の見出し。**`idle` と `checking` は何も描かないのでここへ来ない。** */
function headingOf(status: Exclude<UpdaterStatus, { phase: "idle" | "checking" }>): string {
  switch (status.phase) {
    case "available":
      return "新しいバージョンが利用可能";
    case "downloading":
      return "ダウンロード中…";
    case "installing":
      return "更新を適用しています…";
    case "ready":
      return "更新の準備ができました";
    case "error":
      return failureText(status.failure).heading;
  }
}

export default function UpdaterScreen() {
  const { status, downloadAndInstall, restart, dismiss, skipCurrentVersion } = useUpdater();

  if (status.phase === "idle" || status.phase === "checking") {
    return null;
  }

  // **閉じられるのは、何も進行していないときだけ。** 取得と入替の最中に閉じると、
  // 進み具合を見る唯一の面が消える
  const canDismiss = status.phase === "available" || status.phase === "error";

  return createPortal(
    // **`aria-modal` を名乗らない。** この面は画面の隅に出て背後を止めないので、
    // 名乗ると支援技術にだけ「背後は操作できません」と伝わる
    <div className="updater-overlay" role="status" aria-live="polite" aria-label="アップデート">
      <div className="updater-card">
        <div className="updater-card__header">
          <div className="updater-card__icon" aria-hidden="true">
            <RefreshCw size={18} strokeWidth={1.8} />
          </div>
          <div className="updater-card__heading">{headingOf(status)}</div>
          {canDismiss && (
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

        <div className="updater-card__body">
          {status.phase === "available" && (
            <p className="updater-card__version">
              バージョン <span className="updater-card__version-tag">v{status.version}</span>{" "}
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

          {/*
            **止められないことを言う。** 閉じる口も取り消す口も無い段なので、
            進捗だけ黙って消すと「固まった」と読まれる
          */}
          {status.phase === "installing" && (
            <p className="updater-card__note">
              アプリを入れ替えています。終わるまで閉じないでください。
            </p>
          )}

          {/*
            **「再起動しないと適用されない」と読ませない。** この段ではディスク上の
            アプリはもう入れ替わっていて、次にふつうに起動しても新しい版になる。
            ボタンは「いま切り替える」ためのもの
          */}
          {status.phase === "ready" && (
            <p className="updater-card__note">
              次に起動したときから新しいバージョンになります。いま切り替えることもできます。
            </p>
          )}

          {status.phase === "error" && (
            <>
              <p className="updater-card__hint">{failureText(status.failure).hint}</p>
              <p className="updater-card__error">{status.failure.detail}</p>
            </>
          )}
        </div>

        <div className="updater-card__actions">
          {status.phase === "available" && (
            <>
              <Button size="sm" radius="pill" onClick={() => void skipCurrentVersion()}>
                この版は飛ばす
              </Button>
              <Button
                size="sm"
                radius="pill"
                tone="primary"
                onClick={() => void downloadAndInstall()}
              >
                <Download size={13} strokeWidth={2.2} />
                今すぐ更新
              </Button>
            </>
          )}
          {status.phase === "ready" && (
            <Button size="sm" radius="pill" tone="primary" onClick={() => void restart()}>
              <RefreshCw size={13} strokeWidth={2.2} />
              いま再起動する
            </Button>
          )}
          {status.phase === "error" && (
            <Button size="sm" radius="pill" onClick={dismiss}>
              閉じる
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
