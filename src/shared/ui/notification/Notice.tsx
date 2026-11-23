import { X } from "lucide-react";
import Button from "@/shared/ui/Button/Button";
import type { NotifyAction, VisibleTier } from "@/shared/lib/notification/types";
import { TIER_ICONS, TIER_ROLES } from "./tiers";
import { useNoticeActions } from "./useNoticeActions";
import "./Notice.scss";

const ICON_SIZE = 16;

export type NoticeProps = {
  tier: VisibleTier;
  title: string;
  body?: string;
  actions?: NotifyAction[];
  /** まとめた件数。渡したときだけ出す。条件は `Notification.count` の doc */
  count?: number;
  /** 閉じる手段。閉じられない通知（インライン）では渡さない */
  onDismiss?: () => void;
  className?: string;
};

/**
 * 通知の中身。モーダルとインラインが共有する。帯は `NoticeBand`。
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
  const Icon = TIER_ICONS[tier];
  const { running, failed, invoke } = useNoticeActions(actions);

  const classes = ["notice", `notice--${tier}`, className].filter(Boolean).join(" ");

  return (
    <div className={classes} role={TIER_ROLES[tier]}>
      <Icon className="notice__icon" size={ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      <div className="notice__body">
        <div className="notice__head">
          <p className="notice__title">{title}</p>
          {/* 単位まで出す。数字だけだと、読み上げたときに何の数か分からない */}
          {count !== undefined && <span className="notice__count">{count}件</span>}
        </div>
        {body && <p className="notice__text">{body}</p>}
        {failed && (
          <p className="notice__actionError" role="alert">
            「{failed.label}」を実行できませんでした。
            {failed.failureBody && ` ${failed.failureBody}`}
          </p>
        )}
        {actions.length > 0 && (
          <div className="notice__actions">
            {actions.map((action, at) => (
              // 並び順が鍵。同じ文言が2つ並ぶ通知でも指す先が決まる
              <Button
                key={at}
                size="sm"
                // 先頭だけを `accent` にする。tier では決めない（ADR-0004 決定3）。
                // 2つとも `accent` にすると「エンジンを再起動」が「再試行」と同じ重さに見える
                tone={at === 0 ? "accent" : "neutral"}
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
