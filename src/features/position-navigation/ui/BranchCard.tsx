import { formatMove } from "@/features/position-navigation/lib/shogi-format";
import { memo } from "react";
import "./BranchCard.scss";
import type { BranchOption } from "@/features/position-navigation/model/types";

type Props = {
  branch: BranchOption;
  index: number;
  selected: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLDivElement>;
};

function BranchCard({ branch, index, selected, onClick, ref }: Props) {
  const base = "branch-selector__card";
  const selectedClass = selected ? "branch-selector__card--selected" : "";
  const className = [base, selectedClass].filter(Boolean).join("  ");

  const isMain = index === 0;
  const leftLabel = isMain ? "本譜" : `変化${index}`;
  const rightText = branch.move
    ? formatMove(branch.move)
    : isMain
      ? "次の手"
      : `${branch.tesuu}手目`;

  return (
    <div ref={ref} className={className} onClick={onClick}>
      <div className="branch-selector__header">
        <span className="branch-selector__label">{leftLabel}</span>
        <span className="branch-selector__evaluation">
          <span className="branch-selector__move-pill">{rightText}</span>
        </span>
      </div>

      <div className="branch-selector__sequence">
        <span className="branch-selector__sequence-icon">→</span>
        <span className="branch-selector__sequence-text">
          {branch.tesuu}手目
        </span>
      </div>
    </div>
  );
}

export default memo(BranchCard);
