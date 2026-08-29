import SettingsBadge from "../kit/SettingsBadge";
import "./DefaultBadge.scss";

interface DefaultBadgeProps {
  defaultValue: string | undefined;
  isOverridden: boolean;
}

function formatDefault(value: string | undefined): string {
  if (value === undefined || value === "") return "—";
  return value;
}

export default function DefaultBadge({ defaultValue, isOverridden }: DefaultBadgeProps) {
  const className = isOverridden
    ? "usiOptDefaultBadge usiOptDefaultBadge--overridden"
    : "usiOptDefaultBadge";
  return (
    <span className={className}>
      <SettingsBadge tone={isOverridden ? "accent" : "muted"} shape="badge">
        default: {formatDefault(defaultValue)}
      </SettingsBadge>
    </span>
  );
}
