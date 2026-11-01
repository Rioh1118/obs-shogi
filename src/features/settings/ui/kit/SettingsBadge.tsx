import type { ReactNode } from "react";
import "./SettingsBadge.scss";

export type SettingsBadgeTone = "muted" | "danger" | "warn" | "accent";
type SettingsBadgeShape = "badge" | "pill";

type Props = {
  children: ReactNode;
  tone?: SettingsBadgeTone;
  shape?: SettingsBadgeShape;
};

function SettingsBadge({ children, tone = "muted", shape = "badge" }: Props) {
  return <span className={`sbadge sbadge--${tone} sbadge--${shape}`}>{children}</span>;
}

export default SettingsBadge;
