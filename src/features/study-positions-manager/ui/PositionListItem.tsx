import { forwardRef } from "react";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import { formatShortDate } from "@/shared/lib/date";
import "./PositionListItem.scss";

const STATE_LABELS: Record<string, { label: string; cls: string }> = {
  inbox: { label: "未整理", cls: "inbox" },
  active: { label: "研究中", cls: "active" },
  reference: { label: "資料", cls: "reference" },
  done: { label: "完了", cls: "done" },
};

interface Props {
  position: StudyPosition;
  selected: boolean;
  onClick: () => void;
  turnLabel: string | null;
  tesuu: number;
}

const PositionListItem = forwardRef<HTMLDivElement, Props>(function PositionListItem(
  { position, selected, onClick, turnLabel, tesuu },
  ref,
) {
  const stateInfo = STATE_LABELS[position.state] ?? STATE_LABELS.inbox;
  const updatedDate = formatShortDate(position.updatedAt);

  return (
    <div
      ref={ref}
      className={`sp-list-item ${selected ? "sp-list-item--selected" : ""}`}
      onClick={onClick}
      role="option"
      aria-selected={selected}
    >
      <div className="sp-list-item__top">
        <span className="sp-list-item__label">{position.label || "（タイトルなし）"}</span>
        <span className="sp-list-item__date">{updatedDate}</span>
      </div>
      <div className="sp-list-item__bottom">
        <span className={`sp-list-item__state sp-list-item__state--${stateInfo.cls}`}>
          {stateInfo.label}
        </span>
        {position.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="sp-list-item__tag">
            #{tag}
          </span>
        ))}
        {position.tags.length > 2 && (
          <span className="sp-list-item__tagMore">+{position.tags.length - 2}</span>
        )}
        {turnLabel && (
          <span className="sp-list-item__meta">
            {turnLabel} {tesuu}手目
          </span>
        )}
      </div>
    </div>
  );
});

export default PositionListItem;
