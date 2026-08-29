import { readableMove } from "@/entities/kifu/lib/readableMove";
import "./BranchCard.scss";
import { branchLabel, type BranchOption } from "@/entities/kifu/model/branch";

type Props = {
  branch: BranchOption;
  selected: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLDivElement>;
};

function BranchCard({ branch, selected, onClick, ref }: Props) {
  const base = "branch-selector__card";
  const selectedClass = selected ? "branch-selector__card--selected" : "";
  const className = [base, selectedClass].filter(Boolean).join("  ");

  const rightText =
    readableMove(branch.moveFormat) || (branch.isMainLine ? "次の手" : `${branch.tesuu}手目`);

  return (
    <div ref={ref} className={className} onClick={onClick}>
      <div className="branch-selector__header">
        <span className="branch-selector__label">{branchLabel(branch.forkIndex)}</span>
        <span className="branch-selector__evaluation">
          <span className="branch-selector__move-pill">{rightText}</span>
        </span>
      </div>

      <div className="branch-selector__sequence">
        <span className="branch-selector__sequence-icon">→</span>
        <span className="branch-selector__sequence-text">{branch.tesuu}手目</span>
      </div>
    </div>
  );
}

export default BranchCard;
