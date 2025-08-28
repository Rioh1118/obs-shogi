import React, { useRef, useEffect } from "react";
import type { PositionNode } from "@/types";
import type { NavigationState } from "./PositionNavigationModal";
import { formatMove } from "@/utils/shogi-format";
import "./BranchList.scss";

type Props = {
  branches: PositionNode[];
  selectedIndex: number;
  setNavigationState: React.Dispatch<React.SetStateAction<NavigationState>>;
};

export default function BranchList({
  branches,
  selectedIndex,
  setNavigationState,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // スクロール
  useEffect(() => {
    const id = setTimeout(() => {
      const cards = ref.current?.querySelectorAll<HTMLDivElement>(
        ".branch-selector__card",
      );
      if (!cards) return;
      if (selectedIndex < cards.length) {
        cards[selectedIndex].scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    }, 80);
    return () => clearTimeout(id);
  }, [selectedIndex]);

  const buildCardClass = (idx: number) => {
    const base = "branch-selector__card";
    const selected =
      selectedIndex === idx ? "branch-selector__card--selected" : "";
    return [base, selected].filter(Boolean).join(" ");
  };

  if (branches.length === 0) {
    return (
      <div className="branch-selector" ref={ref}>
        <div className="branch-selector__empty">
          <p>この局面には次の手がありません</p>
        </div>
      </div>
    );
  }

  // 本譜と分岐を分ける
  const mainLine = branches.find((b) => b.isMainLine) || branches[0];
  const variations = branches.filter((b) => b.id !== mainLine.id);

  return (
    <div className="branch-selector">
      {/* 本譜*/}
      <div
        className={buildCardClass(0)}
        onClick={() =>
          setNavigationState((s) => ({ ...s, selectedBranchIndex: 0 }))
        }
      >
        <div className="branch-selector__header">
          <span className="branch-selector__move">本譜</span>
          <span className="branch-selector__evaluation">
            {mainLine.move ? formatMove(mainLine.move) : "次の手"}
          </span>
        </div>
        <div className="branch-selector__sequence">
          <span className="branch-selector__sequence-icon">→</span>
          <span className="branch-selector__sequence-text">
            {mainLine.tesuu}手目
          </span>
        </div>
      </div>
      {/*分岐群*/}
      {variations.map((branch, i) => {
        const idx = i + 1;
        return (
          <div
            key={branch.id}
            className={buildCardClass(idx)}
            onClick={() =>
              setNavigationState((s) => ({ ...s, selectedBranchIndex: idx }))
            }
          >
            <div className="branch-selector__header">
              <span className="branch-selector__move">
                <span className="branch-selector__move-number">変化{idx}</span>
              </span>
              <span className="branch-selector__evaluation">
                <span className="branch-selector__move-text">
                  {branch.move
                    ? formatMove(branch.move)
                    : `${branch.tesuu}手目`}
                </span>
              </span>
            </div>
            <div className="branch-selector__sequence">
              <span className="branch-selector__sequence-icon">→</span>
              <span className="branch-selector__sequence-text">
                {branch.tesuu}手目 {branch.comment ? `(${branch.comment})` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
