import { forwardRef } from "react";
import {
  studyPositionStateLabel,
  type StudyPosition,
} from "@/entities/study-positions/model/types";
import { formatShortDate } from "@/shared/lib/date";
import "./PositionListItem.scss";

interface Props {
  position: StudyPosition;
  selected: boolean;
  onClick: () => void;
  turnShortText: string | null;
  tesuu: number;
}

const PositionListItem = forwardRef<HTMLDivElement, Props>(function PositionListItem(
  { position, selected, onClick, turnShortText, tesuu },
  ref,
) {
  const stateLabel = studyPositionStateLabel(position.state);
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
        <span className={`sp-list-item__state sp-list-item__state--${position.state}`}>
          {stateLabel}
        </span>
        {position.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="sp-list-item__tag">
            #{tag}
          </span>
        ))}
        {position.tags.length > 2 && (
          <span className="sp-list-item__tagMore">+{position.tags.length - 2}</span>
        )}
        {turnShortText && (
          <span className="sp-list-item__meta">
            {turnShortText} {tesuu}手目
          </span>
        )}
      </div>
    </div>
  );
});

export default PositionListItem;
