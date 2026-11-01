import type { ReactNode } from "react";
import "./SettingsTabButton.scss";

import { cx } from "@/features/settings/lib/cx";

type Props = {
  active: boolean;
  label: string;
  onClick: () => void;
  badges?: ReactNode;
};

function SettingsTabButton({ active, label, onClick, badges }: Props) {
  return (
    <button
      type="button"
      className={cx("stab", active && "stab--active")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <div className="stab__row">
        <span className="stab__label">{label}</span>
        <span className="stab__right">{badges}</span>
      </div>
    </button>
  );
}

export default SettingsTabButton;
