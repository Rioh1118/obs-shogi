import type { BranchOption } from "@/types";
import { formatMove } from "@/utils/shogi-format";
import { memo } from "react";
import "./BranchCard.scss";

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
  const headerLeft = isMain ? (
    <span className="branch-selector__move">本譜</span>
  ) : (
    <span className="branch-selector__move">
      <span className="branch-selector__move-number">変化{index}</span>
    </span>
  );
  const headerRight = isMain ? (
    <span className="branch-selector__evaluation">
      {branch.move ? formatMove(branch.move) : "次の手"}
    </span>
  ) : (
    <span className="branch-selector__evaluation">
      <span className="branch-selector__move-text">
        {branch.move ? formatMove(branch.move) : `${branch.tesuu}手目`}
      </span>
    </span>
  );

  return (
    <div ref={ref} className={className} onClick={onClick}>
      <div className="branch-selector__header">
        {headerLeft}
        {headerRight}
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
