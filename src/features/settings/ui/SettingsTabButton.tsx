import type { ReactNode } from "react";
import SettingsBadge, { type SettingsBadgeTone } from "./kit/SettingsBadge";
import "./SettingsTabButton.scss";

type TabBadge = {
  tone?: SettingsBadgeTone;
  children: ReactNode;
};

type Props = {
  active: boolean;
  label: string;
  desc?: string;
  onClick: () => void;
  badges?: TabBadge[];
};

function SettingsTabButton({
  active,
  label,
  desc,
  onClick,
  badges = [],
}: Props) {
  const cls = ["stab", active ? "stab--active" : ""].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cls}
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

      {desc && <div className="stab__desc">{desc}</div>}
    </button>
  );
}

export default SettingsTabButton;
