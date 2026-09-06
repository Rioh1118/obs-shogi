import { useEffect, useRef, useState } from "react";
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
  const [running, setRunning] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 動作が通知そのものを消す（再試行が成功して dismiss する）ので、
  // 返ってきたときには外れていることがある
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const invoke = (action: NotifyAction, at: number) => {
    setActionError(null);
    setRunning(at);
    // `run` が同期で投げる場合も拾えるように、呼び出しごと Promise に入れる
    void Promise.resolve()
      .then(() => action.run())
      .catch(() => {
        // **握り潰さない。** ここを console に落とすと、押した人には
        // 何も起きなかったようにしか見えない。押せる状態のまま理由を出す
        if (mounted.current) setActionError(`「${action.label}」を実行できませんでした。`);
      })
      .finally(() => {
        if (mounted.current) setRunning(null);
      });
  };

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
            {actionError}
          </p>
        )}
        {actions.length > 0 && (
          <div className="notice__actions">
            {actions.map((action, at) => (
              // 並び順が鍵。走っているものを指す `running` も添字なので、
              // 文言を鍵にすると同じ文言が2つ並んだときに指す先がずれる
              <Button
                key={at}
                size="sm"
                // 先頭だけを主にする。段では決めない（ADR-0004 決定3）。
                // 2つとも主にすると「エンジンを再起動」が「再試行」と同じ重さに見える
                tone={at === 0 ? "primary" : "neutral"}
                isLoading={running === at}
                onClick={() => invoke(action, at)}
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
