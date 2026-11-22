import { useId, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import type { NotifyAction, VisibleTier } from "@/shared/lib/notification/types";
import { TIER_ICONS, TIER_ROLES } from "./tiers";
import { useNoticeActions } from "./useNoticeActions";
import "./NoticeBand.scss";

type Props = {
  tier: VisibleTier;
  title: string;
  body?: string;
  actions?: NotifyAction[];
  /** まとめた件数。渡したときだけ出す。条件は `Notification.count` の doc */
  count?: number;
  onDismiss: () => void;
  /** 並びの最後の1行に添えるもの（残りの件数） */
  extra?: ReactNode;
};

const NO_ACTIONS: NotifyAction[] = [];

/**
 * 残る知らせの1行。記号・何が起きたか・次にすること・詳細・閉じる。
 *
 * 本文は1行目だけを見せ、全部は「詳細」を押したときに下へ開く。切り詰めたまま読めない形にしない。
 */
export default function NoticeBand({
  tier,
  title,
  body,
  actions = NO_ACTIONS,
  count,
  onDismiss,
  extra,
}: Props) {
  const Icon = TIER_ICONS[tier];
  const bodyId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const { running, failed, invoke } = useNoticeActions(actions);

  const firstLine = body?.split("\n")[0];

  return (
    <div className={`notice-band notice-band--${tier}`} role={TIER_ROLES[tier]}>
      <Icon className="notice-band__icon" size={16} strokeWidth={2} aria-hidden="true" />

      <p className="notice-band__title" title={title}>
        {title}
      </p>

      <p className="notice-band__text" title={body}>
        {firstLine}
      </p>

      <div className="notice-band__actions">
        {/* 単位まで出す。数字だけだと、読み上げたときに何の数か分からない */}
        {count !== undefined && <span className="notice-band__count">{count}件</span>}
        {actions.map((action, at) => (
          // 並び順が鍵。同じ文言が2つ並ぶ通知でも指す先が決まる
          <button
            key={at}
            type="button"
            className={`notice-band__action ${at === 0 ? "notice-band__action--first" : ""}`}
            // 待っていることは伝えるが押せなくはしない（`useNoticeActions` が弾く）
            aria-busy={running === action || undefined}
            onClick={() => invoke(action)}
          >
            {action.label}
          </button>
        ))}
        {body && (
          <button
            type="button"
            className="notice-band__action"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => setIsOpen((v) => !v)}
          >
            詳細
            <ChevronDown className="notice-band__chevron" size={12} aria-hidden="true" />
          </button>
        )}
        {extra}
      </div>

      <button
        type="button"
        className="notice-band__close"
        aria-label={`「${title}」を閉じる`}
        onClick={onDismiss}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      {failed && (
        <p className="notice-band__failed" role="alert">
          「{failed.label}」を実行できませんでした。
          {failed.failureBody && ` ${failed.failureBody}`}
        </p>
      )}

      {body && isOpen && (
        <p className="notice-band__body" id={bodyId}>
          {body}
        </p>
      )}
    </div>
  );
}
