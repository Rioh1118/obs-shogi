import { readableMove } from "@/entities/kifu/lib/readableMove";
import { memo } from "react";
import "./BranchCard.scss";
import { branchIndexFromForkIndex, type BranchOption } from "@/entities/kifu/model/branch";

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

  // 番号は表示順ではなく forkIndex から作る。棋譜ストリームの分岐メニューと
  // 同じ番号で呼べないと、片方を見て他方を操作したときに別の分岐を指す。
  const leftLabel =
    branch.forkIndex == null ? "本譜" : `変化${branchIndexFromForkIndex(branch.forkIndex)}`;
  const rightText =
    readableMove(branch.moveFormat) ||
    (branch.isMainLine ? "次の手" : `${branch.tesuu}手目`);

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
        <span className="branch-selector__sequence-text">{branch.tesuu}手目</span>
      </div>
    </div>
  );
}

export default memo(BranchCard);
