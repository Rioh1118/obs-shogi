import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
} from "react";
import "./BranchList.scss";
import BranchCard from "./BranchCard";
import type { BranchOption } from "@/features/position-navigation/model/types";

type Props = {
  branches: BranchOption[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export default function BranchList({
  branches,
  selectedIndex,
  onSelectIndex,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const rafRef = useRef<number | null>(null);
  const cancelScrollAnim = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const springScrollTo = useCallback(
    (target: number) => {
      const el = containerRef.current;
      if (!el) return;

      cancelScrollAnim();

      let x = el.scrollTop;
      let v = 0;
      let last = performance.now();

      // 触感チューニング（硬さ/減衰）: ここは好みで微調整
      const k = 260; // stiffness
      const c = 34; // damping

      const step = (now: number) => {
        const dt = Math.min(0.032, (now - last) / 1000);
        last = now;

        const a = -k * (x - target) - c * v;
        v += a * dt;
        x += v * dt;

        el.scrollTop = x;

        if (Math.abs(v) < 8 && Math.abs(x - target) < 0.5) {
          el.scrollTop = target;
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [cancelScrollAnim],
  );

  const setCardRef = (index: number) => (el: HTMLDivElement | null) => {
    cardRefs.current[index] = el;
  };

  const [cursor, setCursor] = useState({ y: 0, h: 0, ready: false });

  // スクロール
  useLayoutEffect(() => {
    const container = containerRef.current;
    const card = cardRefs.current[selectedIndex];
    if (!container || !card) return;

    // cardの位置はスクロールコンテンツ内のoffsetで取る（安定）
    const y = card.offsetTop;
    const h = card.offsetHeight;
    setCursor({ y, h, ready: true });

    // ------- “粘性（抵抗）”を作る：safe zone外だけスクロール -------
    if (isUserScrollingRef.current) return;

    const viewTop = container.scrollTop;
    const viewH = container.clientHeight;

    const cardTopInView = y - viewTop;
    const cardBottomInView = cardTopInView + h;

    // safe zone: 中央寄りに固定して“吸着感”
    const safeTop = viewH * 0.22;
    const safeBottom = viewH * 0.78;

    const shouldScroll =
      cardTopInView < safeTop || cardBottomInView > safeBottom;

    if (shouldScroll) {
      const target = clamp(
        y - viewH / 2 + h / 2,
        0,
        container.scrollHeight - viewH,
      );
      springScrollTo(target);
    }
  }, [selectedIndex, branches.length, springScrollTo]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const markUserScrolling = () => {
      isUserScrollingRef.current = true;
      cancelScrollAnim();

      if (scrollTimeoutRef.current)
        window.clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = window.setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 140); // ← 1msは短すぎ。人間の操作は“余韻”がある
    };

    container.addEventListener("wheel", markUserScrolling, { passive: true });
    container.addEventListener("touchstart", markUserScrolling, {
      passive: true,
    });
    container.addEventListener("pointerdown", markUserScrolling, {
      passive: true,
    });
    container.addEventListener("scroll", markUserScrolling, { passive: true });

    return () => {
      container.removeEventListener("wheel", markUserScrolling);
      container.removeEventListener("touchstart", markUserScrolling);
      container.removeEventListener("pointerdown", markUserScrolling);
      container.removeEventListener("scroll", markUserScrolling);
      if (scrollTimeoutRef.current)
        window.clearTimeout(scrollTimeoutRef.current);
      cancelScrollAnim();
    };
  }, [cancelScrollAnim]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const card = entry.target as HTMLElement;
          card.setAttribute(
            "data-in-view",
            entry.isIntersecting ? "true" : "false",
          );
        });
      },
      {
        root: container,
        rootMargin: "-20% 0px -20% 0px",
        threshold: [0, 0.5, 1],
      },
    );

    cardRefs.current.forEach((card) => card && observer.observe(card));
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
    <div
      className="branch-selector"
      ref={containerRef}
      style={
        {
          "--cursor-y": `${cursor.y}px`,
          "--cursor-h": `${cursor.h}px`,
          "--cursor-o": cursor.ready ? 1 : 0,
        } as React.CSSProperties
      }
    >
      <div className="branch-selector__cursor" aria-hidden="true" />

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
