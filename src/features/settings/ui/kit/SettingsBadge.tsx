import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import "./SettingsBadge.scss";

type SettingsBadgeTone = "muted" | "danger" | "warn" | "accent";

type Props = {
  children: ReactNode;
  tone?: SettingsBadgeTone;
};

/**
 * 行や見出しに、いまの状態を1語で添える。枠も背景も付けない
 * （`design-system/design_system/components/tag.md`）。
 */
function SettingsBadge({ children, tone = "muted" }: Props) {
  return (
    <span className={`sbadge sbadge--${tone}`}>
      {(tone === "warn" || tone === "danger") && <AlertTriangle size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}

export default SettingsBadge;
