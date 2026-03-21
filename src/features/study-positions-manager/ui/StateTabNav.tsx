import type { StudyPositionState } from "@/entities/study-positions/model/types";
import "./StateTabNav.scss";

const TABS: { value: StudyPositionState | null; label: string }[] = [
  { value: null, label: "全て" },
  { value: "inbox", label: "未整理" },
  { value: "active", label: "研究中" },
  { value: "reference", label: "資料" },
  { value: "done", label: "完了" },
];

interface Props {
  value: StudyPositionState | null;
  onChange: (value: StudyPositionState | null) => void;
  counts: Record<string, number>;
  totalCount: number;
}

export default function StateTabNav({
  value,
  onChange,
  counts,
  totalCount,
}: Props) {
  return (
    <nav className="state-tab-nav" role="tablist" aria-label="研究状態">
      {TABS.map((tab) => {
        const count = tab.value === null ? totalCount : (counts[tab.value] ?? 0);
        const isActive = value === tab.value;
        return (
          <button
            key={tab.value ?? "all"}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`state-tab-nav__tab ${isActive ? "state-tab-nav__tab--active" : ""}`}
            onClick={() => onChange(tab.value)}
          >
            <span className="state-tab-nav__label">{tab.label}</span>
            <span className="state-tab-nav__count">{count}</span>
          </button>
        );
      })}
    </nav>
  );
}
