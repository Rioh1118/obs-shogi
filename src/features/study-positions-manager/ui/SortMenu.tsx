import { ChevronDown } from "lucide-react";
import { SORT_OPTIONS, type SortKey } from "../lib/positionFilters";

type Props = {
  value: SortKey;
  open: boolean;
  onToggle: () => void;
  onSelect: (value: SortKey) => void;
};

/** 課題局面の一覧の並べ替えの選択。見た目は `StudyPositionsManagerModal.scss` が持つ */
export default function SortMenu({ value, open, onToggle, onSelect }: Props) {
  const sortLabel = SORT_OPTIONS.find((o) => o.value === value)?.label ?? "更新日↓";

  return (
    <div className="sp-manager__sortBtn">
      <button type="button" className="sp-manager__sortTrigger" onClick={onToggle}>
        <span>{sortLabel}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="sp-manager__sortMenu">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`sp-manager__sortOption ${value === opt.value ? "sp-manager__sortOption--active" : ""}`}
              onClick={() => onSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
