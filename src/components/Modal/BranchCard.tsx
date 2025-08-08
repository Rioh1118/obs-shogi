// src/components/PositionNavigationModal/BranchCard.tsx
import React from "react";
import { JKFPlayer } from "json-kifu-format";
import type { Branch } from "@/types/branchNav";

type Props = {
  branch: Branch;
  cardIndex: number;
  className: string;
  disabled: boolean;
  onClick: () => void;
};

const BranchCard: React.FC<Props> = ({
  branch,
  cardIndex,
  className,
  disabled,
  onClick,
}) => {
  return (
    <div className={className} onClick={disabled ? undefined : onClick}>
      <div className="branch-selector__header">
        <span className="branch-selector__move">
          <span className="branch-selector__move-number">変化{cardIndex}</span>
        </span>
        <span className="branch-selector__evaluation">
          <span className="branch-selector__move-text">
            {branch.moves[0]?.description ||
              JKFPlayer.moveToReadableKifu({ move: branch.firstMove }) ||
              String(branch.firstMove)}
          </span>
        </span>
      </div>
      <div className="branch-selector__sequence">
        <span className="branch-selector__sequence-icon">→</span>
        <span className="branch-selector__sequence-text">
          {branch.startTesuu + 1}手目から {branch.length}手の変化
        </span>
      </div>
    </div>
  );
};

export default BranchCard;
