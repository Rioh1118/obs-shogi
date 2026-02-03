import React, { useRef, useEffect, useLayoutEffect } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const setCardRef = (index: number) => (el: HTMLDivElement | null) => {
    cardRefs.current[index] = el;
  };

  // スクロール
  useLayoutEffect(() => {
    // 初回レンダリング時は即時スクロール
    const targetCard = cardRefs.current[selectedIndex];
    if (!targetCard || !containerRef.current) return;

    // ユーザーがスクロール中でなければ自動スクロール
    if (!isUserScrollingRef.current) {
      requestAnimationFrame(() => {
        targetCard.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      });
    }
  }, [selectedIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScrollStart = () => {
      isUserScrollingRef.current = true;

      // スクロール終了を検知
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 1); // スクロール終了後10ms待機
    };

    container.addEventListener("scroll", handleScrollStart, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScrollStart);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const card = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            card.setAttribute("data-in-view", "true");
          } else {
            card.setAttribute("data-in-view", "false");
          }
        });
      },
      {
        root: container,
        rootMargin: "-20% 0px -20% 0px",
        threshold: [0, 0.5, 1],
      },
    );

    cardRefs.current.forEach((card) => {
      if (card) observer.observe(card);
    });

    return () => observer.disconnect();
  }, [branches.length]);

  const buildCardClass = (idx: number) => {
    const base = "branch-selector__card";
    const selected =
      selectedIndex === idx ? "branch-selector__card--selected" : "";
    return [base, selected].filter(Boolean).join(" ");
  };

  if (branches.length === 0) {
    return (
      <div className="branch-selector" ref={containerRef}>
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
    <div className="branch-selector" ref={containerRef}>
      {/* 本譜*/}
      <div
        ref={setCardRef(0)}
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
            ref={setCardRef(idx)}
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
