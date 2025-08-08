// src/components/PositionNavigationModal/useNavKeys.ts
import { useEffect } from "react";
import type { Branch, NavigationState } from "@/types/branchNav";
import type { BranchService } from "@/services/branch/BranchService";
import { stateBrief, trace } from "./debug";

type Params = {
  enabled: boolean;
  branchService: BranchService | null;
  navigationState: NavigationState;
  branches: Branch[];
  effectiveTotalMoves: number;
  setNavigationState: React.Dispatch<React.SetStateAction<NavigationState>>;
  onConfirm: () => void;
  onClose: () => void;
};

export default function useNavKeys({
  enabled,
  branchService,
  navigationState,
  branches,
  effectiveTotalMoves,
  setNavigationState,
  onConfirm,
  onClose,
}: Params) {
  useEffect(() => {
    if (!enabled || !branchService) return;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "k":
          e.preventDefault();
          selectFork(e.key === "j" ? "down" : "up");
          break;
        case "h":
          e.preventDefault();
          movePrev();
          break;
        case "l":
          e.preventDefault();
          moveNext();
          break;
        case "Enter":
          e.preventDefault();
          onConfirm();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, branchService, navigationState, branches, effectiveTotalMoves]);

  const selectFork = (dir: "up" | "down") => {
    const count = branches.length; // 変化数
    setNavigationState((s) => {
      const cur = s.selectedFork;
      const next =
        dir === "down" ? Math.min(count, cur + 1) : Math.max(0, cur - 1);
      if (next === cur) return s;
      return { ...s, selectedFork: next };
    });
  };

  const movePrev = () => {
    if (!branchService) return;
    const result = branchService.movePrevious(navigationState);
    if (result.success && result.newState) setNavigationState(result.newState);
  };

  const moveNext = () => {
    if (!branchService) return;
    trace("KEY:l before", { ...stateBrief(navigationState) });
    const result = branchService.moveNext(
      navigationState,
      branches,
      effectiveTotalMoves,
    );
    if (result.success && result.newState) {
      trace("KEY:l after", { ...stateBrief(result.newState) });
      setNavigationState(result.newState);
    }
  };
}
