import type { StudyPositionState } from "@/entities/study-positions/model/types";
import "./StudyPositionStateSegment.scss";

const STATE_OPTIONS: { value: StudyPositionState; label: string }[] = [
  { value: "inbox", label: "未整理" },
  { value: "active", label: "研究中" },
  { value: "reference", label: "資料" },
  { value: "done", label: "完了" },
];

interface Props {
  value: StudyPositionState;
  onChange: (value: StudyPositionState) => void;
  disabled?: boolean;
}

export default function StudyPositionStateSegment({
  value,
  onChange,
  disabled = false,
}: Props) {
  return (
    <div className="sp-state-seg" role="radiogroup" aria-label="研究状態">
      {STATE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`sp-state-seg__item ${value === opt.value ? "sp-state-seg__item--active" : ""}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
