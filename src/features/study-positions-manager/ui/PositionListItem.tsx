import type { Ref } from "react";
import {
  studyPositionStateLabel,
  type StudyPosition,
} from "@/entities/study-positions/model/types";
import { formatShortDate } from "@/shared/lib/date";
import "./PositionListItem.scss";

type Props = {
  position: StudyPosition;
  selected: boolean;
  onClick: () => void;
  turnShortText: string | null;
  tesuu: number;
  ref?: Ref<HTMLDivElement>;
};

export default function PositionListItem({
  position,
  selected,
  onClick,
  turnShortText,
  tesuu,
  ref,
}: Props) {
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
      <span className="sp-list-item__label">{position.label || "（タイトルなし）"}</span>
      <span className="sp-list-item__date">{updatedDate}</span>

      <span className="sp-list-item__tags">
        <span className="sp-list-item__state">{stateLabel}</span>
        {position.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="sp-list-item__tag">
            #{tag}
          </span>
        ))}
        {position.tags.length > 2 && (
          <span className="sp-list-item__tagMore">+{position.tags.length - 2}</span>
        )}
      </span>
      {turnShortText && (
        <span className="sp-list-item__meta">
          {turnShortText} {tesuu}手目
        </span>
      )}
    </div>
  );
}
