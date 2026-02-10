import { useRef, useEffect, useLayoutEffect } from "react";
import "./BranchList.scss";
import type { BranchOption } from "@/types";
import BranchCard from "./BranchCard";

type Props = {
  branches: BranchOption[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
};

export default function BranchList({
  branches,
  selectedIndex,
  onSelectIndex,
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

  if (branches.length === 0) {
    return (
      <div className="branch-selector" ref={containerRef}>
        <div className="branch-selector__empty">
          <p>この局面には次の手がありません</p>
        </div>
      </div>
    );
  }

  return (
    <div className="branch-selector" ref={containerRef}>
      {branches.map((branch, idx) => (
        <BranchCard
          key={branch.id}
          ref={setCardRef(idx)}
          branch={branch}
          index={idx}
          selected={selectedIndex === idx}
          onClick={() => onSelectIndex(idx)}
        />
      ))}
    </div>
  );
}
