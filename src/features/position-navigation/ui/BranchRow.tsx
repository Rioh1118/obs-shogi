import type { Ref } from "react";
import { readableMove } from "@/entities/kifu/lib/readableMove";
import { branchLabel, type BranchOption } from "@/entities/kifu/model/branch";

type Props = {
  branch: BranchOption;
  selected: boolean;
  onClick: () => void;
  ref?: Ref<HTMLDivElement>;
};

/** 次の手の候補の1行。左から、本譜か変化か、指し手、何手目か */
export default function BranchRow({ branch, selected, onClick, ref }: Props) {
  const move =
    readableMove(branch.moveFormat) || (branch.isMainLine ? "次の手" : `${branch.tesuu}手目`);

  return (
    <div
      ref={ref}
      className={selected ? "branch-list__row branch-list__row--selected" : "branch-list__row"}
      onClick={onClick}
    >
      <span className="branch-list__label">{branchLabel(branch.forkIndex)}</span>
      <span className="branch-list__move">{move}</span>
      <span className="branch-list__tesuu">{branch.tesuu}手目</span>
    </div>
  );
}
