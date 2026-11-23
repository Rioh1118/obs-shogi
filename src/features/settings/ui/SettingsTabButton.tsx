import { AlertTriangle } from "lucide-react";
import "./SettingsTabButton.scss";

import { cx } from "@/features/settings/lib/cx";

type Props = {
  active: boolean;
  label: string;
  /** そのままではエンジンが動かない */
  needsSetup: boolean;
  onClick: () => void;
};

function SettingsTabButton({ active, label, needsSetup, onClick }: Props) {
  return (
    <button
      type="button"
      className={cx("stab", active && "stab--active")}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="stab__label">{label}</span>
      {needsSetup && (
        <span className="stab__needs" title="設定が要ります">
          <AlertTriangle size={13} role="img" aria-label="設定が要ります" />
        </span>
      )}
    </button>
  );
}

export default SettingsTabButton;
