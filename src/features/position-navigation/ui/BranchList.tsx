import { useEffect, useRef } from "react";
import type { BranchOption } from "@/entities/kifu/model/branch";
import BranchRow from "./BranchRow";
import "./BranchList.scss";

type Props = {
  branches: BranchOption[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
};

/** 次の手の候補の一覧。本譜、変化の順 */
export default function BranchList({ branches, selectedIndex, onSelectIndex }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // 選んだ行が見えていなければ、見える所まで送る
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, branches]);

  return (
    <div className="branch-list">
      {branches.length === 0 ? (
        <p className="branch-list__empty">この局面には次の手がありません</p>
      ) : (
        branches.map((branch, idx) => (
          <BranchRow
            key={branch.isMainLine ? "main" : `fork-${branch.forkIndex}`}
            ref={selectedIndex === idx ? selectedRef : undefined}
            branch={branch}
            selected={selectedIndex === idx}
            onClick={() => onSelectIndex(idx)}
          />
        ))
      )}
    </div>
  );
}
