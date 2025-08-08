import React, { useRef, useEffect } from "react";
import type { Branch, NavigationState, ForkPointer } from "@/types/branchNav";
import { trace } from "./debug";

type Props = {
  branches: Branch[];
  selectedFork: number; // 0 = 本筋, 1~ = forks
  activePath: ForkPointer[];
  setNavigationState: React.Dispatch<React.SetStateAction<NavigationState>>;
};

const BranchList: React.FC<Props> = ({
  branches,
  selectedFork,
  activePath,
  setNavigationState,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // スクロール
  useEffect(() => {
    const id = setTimeout(() => {
      const cards = ref.current?.querySelectorAll<HTMLDivElement>(
        ".branch-selector__card",
      );
      if (!cards) return;
      if (selectedFork < cards.length) {
        cards[selectedFork].scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    }, 80);
    return () => clearTimeout(id);
  }, [selectedFork]);

  useEffect(() => {
    trace("BRANCH_LIST: props", {
      selectedFork,
      activePath,
      branchIds: branches.map((b) => b.id),
    });
  }, [selectedFork, activePath, branches]);

  const buildCardClass = (isMain: boolean, idx: number) => {
    const base = "branch-selector__card";
    const selected =
      selectedFork === idx ? "branch-selector__card--selected" : "";

    let active = "";
    if (isMain) {
      if (activePath.length === 0) active = "branch-selector__card--active";
    } else {
      const br = branches[idx - 1];
      if (br && isPathEqual(activePath, br.path)) {
        active = "branch-selector__card--active";
      }
    }
    return [base, selected, active].filter(Boolean).join(" ");
  };

  return (
    <div className="branch-selector" ref={ref}>
      {/* 本譜 */}
      <div
        className={buildCardClass(true, 0)}
        onClick={() => setNavigationState((s) => ({ ...s, selectedFork: 0 }))}
      >
        <div className="branch-selector__header">
          <span className="branch-selector__move">本譜</span>
          <span className="branch-selector__evaluation">メイン線の手順</span>
        </div>
        <div className="branch-selector__sequence">→ 棋譜の本線を進む</div>
      </div>

      {/* 分岐群 */}
      {branches.length ? (
        branches.map((branch, i) => {
          const idx = i + 1;
          return (
            <div
              key={branch.id}
              className={buildCardClass(false, idx)}
              onClick={() =>
                setNavigationState((s) => ({ ...s, selectedFork: idx }))
              }
            >
              <div className="branch-selector__header">
                <span className="branch-selector__move">
                  <span className="branch-selector__move-number">
                    変化{idx}
                  </span>
                </span>
                <span className="branch-selector__evaluation">
                  <span className="branch-selector__move-text">
                    {branch.description ?? String(branch.firstMove)}
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
        })
      ) : (
        <div className="branch-selector__empty">
          <p>この局面には分岐がありません</p>
          <p>[j/k] キーで分岐を選択できます</p>
        </div>
      )}
    </div>
  );
};

function isPathEqual(a: ForkPointer[], b: ForkPointer[]) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v.te === b[i].te && v.forkIndex === b[i].forkIndex);
}

export default BranchList;
