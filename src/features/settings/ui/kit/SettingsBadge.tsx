import type { ReactNode } from "react";
import "./SettingsBadge.scss";

export type SettingsBadgeTone = "muted" | "danger" | "warn" | "accent";
export type SettingsBadgeShape = "badge" | "pill";

type Props = {
  children: ReactNode;
  tone?: SettingsBadgeTone;
  shape?: SettingsBadgeShape;
  className?: string;
};

function SettingsBadge({
  children,
  tone = "muted",
  shape = "badge",
  className,
}: Props) {
  const cls = ["sbadge", `sbadge--${tone}`, `sbadge--${shape}`, className]
    .filter(Boolean)
    .join(" ");

  return <span className={cls}>{children}</span>;
}

export default SettingsBadge;
