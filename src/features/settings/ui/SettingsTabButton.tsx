import type { ReactNode } from "react";
import SettingsBadge, { type SettingsBadgeTone } from "./kit/SettingsBadge";
import "./SettingsTabButton.scss";

import { cx } from "@/features/settings/lib/cx";

type TabBadge = {
  tone?: SettingsBadgeTone;
  children: ReactNode;
};

type Props = {
  active: boolean;
  label: string;
  onClick: () => void;
  badges?: TabBadge[];
};

function SettingsTabButton({ active, label, onClick, badges = [] }: Props) {
  return (
    <button
      type="button"
      className={cx("stab", active && "stab--active")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <div className="stab__row">
        <span className="stab__label">{label}</span>
        <span className="stab__right">
          {badges.map((b, i) => (
            <SettingsBadge key={i} tone={b.tone}>
              {b.children}
            </SettingsBadge>
          ))}
        </span>
      </div>
    </button>
  );
}

export default SettingsTabButton;
