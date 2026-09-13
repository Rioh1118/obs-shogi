import {
  STUDY_POSITION_STATES,
  type StudyPositionState,
} from "@/entities/study-positions/model/types";
import "./StudyPositionStateSegment.scss";

interface Props {
  value: StudyPositionState;
  onChange: (value: StudyPositionState) => void;
  disabled?: boolean;
}

export default function StudyPositionStateSegment({ value, onChange, disabled = false }: Props) {
  return (
    <div className="sp-state-seg" role="radiogroup" aria-label="研究状態">
      {STUDY_POSITION_STATES.map((opt) => (
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
