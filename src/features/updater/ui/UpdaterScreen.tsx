import { useRef } from "react";
import { createPortal } from "react-dom";
import { useUpdater } from "@/entities/updater";
import type { UpdaterFailure, UpdaterStatus } from "@/entities/updater";
import type { NotifyAction, VisibleTier } from "@/shared/lib/notification/types";
import NoticeBand from "@/shared/ui/notification/NoticeBand";
import { usePublishedHeight } from "@/shared/ui/notification/usePublishedHeight";
import "./UpdaterScreen.scss";

/** 帯1行ぶんの中身 */
type Band = {
  tier: VisibleTier;
  title: string;
  text: string;
  body?: string;
  actions?: NotifyAction[];
  /** 取得の進み具合（％） */
  progress?: number;
  canDismiss: boolean;
};

/**
 * 失敗の見出しと、次に何をすればよいかを返す。
 *
 * 例外の文字列を見出しにしない。内部の語がそのまま利用者に届く（ADR-0004）。
 * どこまで進んでいたかは `stage` が持っているので、綴りを読む必要はない。
 *
 * **`install` の警告を弱めない。** macOS の入替は旧バンドルを退避してから
 * 新しいものを置くので、その間に落ちるとアプリの実体が残らないことがある。
 * 走っているプロセスは生きているが、閉じると起動できなくなる。
 */
function failureBand({ stage, detail }: UpdaterFailure): Band {
  if (stage === "download") {
    const hint = "通信を確認して、もう一度お試しください。アプリはそのまま使えます。";
    return {
      tier: "warning",
      title: "更新を取得できませんでした",
      text: hint,
      body: `${hint}\n${detail}`,
      canDismiss: true,
    };
  }
  const hint =
    "このまま終了すると起動できなくなることがあります。閉じる前に、配布元から最新版を入れ直してください。";
  return {
    tier: "fatal",
    title: "更新を適用できませんでした",
    text: hint,
    body: `${hint}\n${detail}`,
    canDismiss: true,
  };
}

/**
 * いまの段階で出す帯。何も出さない段階では `null`。
 *
 * **閉じられるのは、何も進行していないときだけ。** 取得と入替の最中に閉じると、
 * 進み具合を見る唯一の帯が消える。
 */
function bandOf(
  status: UpdaterStatus,
  run: {
    update: () => Promise<void>;
    skip: () => Promise<void>;
    restart: () => Promise<void>;
  },
): Band | null {
  switch (status.phase) {
    case "idle":
    case "checking":
      return null;
    case "available":
      return {
        tier: "info",
        title: "新しいバージョンが利用可能",
        text: `バージョン v${status.version} が公開されています`,
        actions: [
          { label: "今すぐ更新", run: run.update },
          { label: "この版は飛ばす", run: run.skip },
        ],
        canDismiss: true,
      };
    case "downloading":
      return {
        tier: "info",
        title: "ダウンロード中…",
        text: `${status.progress}%`,
        progress: status.progress,
        canDismiss: false,
      };
    // **止められないことを言う。** 閉じる操作も取り消す操作も無い段階なので、
    // 進捗だけ黙って消すと「固まった」と読まれる
    case "installing":
      return {
        tier: "info",
        title: "更新を適用しています…",
        text: "アプリを入れ替えています。終わるまで閉じないでください。",
        canDismiss: false,
      };
    // **「再起動しないと適用されない」と読ませない。** この段階ではディスク上の
    // アプリはもう入れ替わっていて、次にふつうに起動しても新しい版になる。
    // ボタンは「いま切り替える」ためのもの
    case "ready":
      return {
        tier: "info",
        title: "更新の準備ができました",
        text: "次に起動したときから新しいバージョンになります。いま切り替えることもできます。",
        actions: [{ label: "いま再起動", run: run.restart }],
        canDismiss: false,
      };
    case "error":
      return failureBand(status.failure);
  }
}

/**
 * 更新の知らせ。残る知らせの帯（`NotificationLayer`）の下に、同じ形で1行出す。
 *
 * 通知の層に載せないのは、本体の境界が落ちて層ごと消えたときにも出すため（`App.tsx`）。
 * 高さは自分で名乗り、作業画面とモーダルがそのぶん下へ始まる（`global.scss` の `--top-bands-h`）。
 */
export default function UpdaterScreen() {
  const { status, downloadAndInstall, restart, dismiss, skipCurrentVersion } = useUpdater();
  const ref = useRef<HTMLDivElement>(null);

  const band = bandOf(status, {
    update: downloadAndInstall,
    skip: skipCurrentVersion,
    restart,
  });
  usePublishedHeight(ref, "--update-band-h", band !== null);

  if (!band) return null;

  return createPortal(
    // **`aria-modal` を名乗らない。** 背後を止めないので、名乗ると支援技術にだけ
    // 「背後は操作できません」と伝わる。読み上げの役は帯が tier から名乗る
    <div className="updater-band" ref={ref}>
      <NoticeBand
        tier={band.tier}
        title={band.title}
        text={band.text}
        body={band.body}
        actions={band.actions}
        onDismiss={band.canDismiss ? dismiss : undefined}
        extra={
          band.progress !== undefined && (
            <span className="updater-band__progress">
              <span className="updater-band__progressFill" style={{ width: `${band.progress}%` }} />
            </span>
          )
        }
      />
    </div>,
    document.body,
  );
}
