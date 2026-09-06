import { useState } from "react";
import { CircleAlert, Info, OctagonX, TriangleAlert, X } from "lucide-react";
import Button from "@/shared/ui/Button/Button";
import type { NotifyAction, VisibleTier } from "@/shared/lib/notification/types";
import "./Notice.scss";

const ICON_SIZE = 16;

const ICONS: Record<VisibleTier, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  fatal: OctagonX,
};

/**
 * 支援技術に割り込ませるか。
 *
 * `danger` と `fatal` は**繰り返しでは直らない**ので、いま読んでいるものを
 * 中断してでも伝える。`info` と `warning` は読み終わってからでよい。
 */
const ROLES: Record<VisibleTier, "status" | "alert"> = {
  info: "status",
  warning: "status",
  danger: "alert",
  fatal: "alert",
};

export type NoticeProps = {
  tier: VisibleTier;
  title: string;
  body?: string;
  actions?: NotifyAction[];
  /**
   * 畳んだ件数。**渡したときだけ出す。**
   * 畳んでいない通知に常に「1」が付くと、数に意味が無くなる
   */
  count?: number;
  /** 閉じる手段。閉じられない通知（インライン）では渡さない */
  onDismiss?: () => void;
  className?: string;
};

/**
 * 通知の中身。トースト・バナー・モーダル・インラインが共有する。
 *
 * **自分では位置を持たない。** どこに置くかは載せる側が決める（ADR-0004 決定4）。
 */
export default function Notice({
  tier,
  title,
  body,
  actions = [],
  count,
  onDismiss,
  className,
}: NoticeProps) {
  const Icon = ICONS[tier];
  // **添字でなく動作そのもので覚える。** 通知は畳まれると `actions` が丸ごと
  // 差し替わるのに id は動かない（再マウントしない）ので、添字で覚えると
  // 一度も押していないボタンが busy かつ押せない状態で残る。押せなくなるのは
  // たいてい「エンジンが応答しない」ときで、唯一の復帰導線がそれになる
  const [running, setRunning] = useState<NotifyAction | null>(null);
  const [failed, setFailed] = useState<NotifyAction | null>(null);

  const invoke = (action: NotifyAction) => {
    // **二重起動はここで止める。ボタンを `disabled` にしない。**
    // フォーカス中の要素が `disabled` になるとブラウザは blur し、行き先は `<body>`。
    // 通知は `#modal-root`（文書の末尾）に描かれるので、そこから戻るには
    // アプリ全体を Tab で辿り直すことになり、直後に出る失敗の理由へ帰れない
    if (running !== null) return;
    setFailed(null);
    setRunning(action);
    // `run` が同期で投げる場合も拾えるように、呼び出しごと Promise に入れる
    void Promise.resolve()
      .then(() => action.run())
      .catch((cause: unknown) => {
        // **握り潰さない。** 表示だけに落とすと、押した人には何が起きたか伝わるが
        // 原因がどこにも残らない。**画面には利用者の言葉、原因はログ**に分ける
        console.error(`[notification] 「${action.label}」が失敗した`, cause);
        setFailed(action);
      })
      .finally(() => {
        // 走り終えたものだけを落とす。差し替わったあとの動作を消さない
        setRunning((current) => (current === action ? null : current));
      });
  };

  // 差し替えられた動作の失敗を、新しいボタンの下に出したままにしない
  const actionError = failed && actions.includes(failed) ? failed : null;

  const classes = ["notice", `notice--${tier}`, className].filter(Boolean).join(" ");

  return (
    <div className={classes} role={ROLES[tier]}>
      <Icon className="notice__icon" size={ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      <div className="notice__body">
        <div className="notice__head">
          <p className="notice__title">{title}</p>
          {/* 単位まで出す。数字だけだと、読み上げたときに何の数か分からない */}
          {count !== undefined && <span className="notice__count">{count}件</span>}
        </div>
        {body && <p className="notice__text">{body}</p>}
        {actionError && (
          <p className="notice__actionError" role="alert">
            「{actionError.label}」を実行できませんでした。
            {actionError.failureBody && ` ${actionError.failureBody}`}
          </p>
        )}
        {actions.length > 0 && (
          <div className="notice__actions">
            {actions.map((action, at) => (
              // 並び順が鍵。同じ文言が2つ並ぶ通知でも指す先が決まる
              <Button
                key={at}
                size="sm"
                // 先頭だけを主にする。段では決めない（ADR-0004 決定3）。
                // 2つとも主にすると「エンジンを再起動」が「再試行」と同じ重さに見える
                tone={at === 0 ? "primary" : "neutral"}
                // 待っていることは伝えるが押せなくはしない（`invoke` が弾く）
                busy={running === action}
                onClick={() => invoke(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {onDismiss && (
        <button type="button" className="notice__close" aria-label="閉じる" onClick={onDismiss}>
          <X size={ICON_SIZE} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
