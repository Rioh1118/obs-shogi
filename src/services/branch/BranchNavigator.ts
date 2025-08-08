// src/services/branch/BranchNavigator.ts
import type { JKFPlayer } from "json-kifu-format";
import type {
  Branch,
  NavigationState,
  BranchNavigationResult,
} from "@/types/branchNav";

export class BranchNavigator {
  static movePrevious(
    state: NavigationState,
    viewBranches: Branch[],
  ): BranchNavigationResult {
    const { preview, activeBranch } = state;

    if (preview.branchIndex > 0 && activeBranch) {
      if (preview.branchSteps > 0) {
        return ok({
          ...state,
          preview: {
            ...preview,
            tesuu: preview.tesuu - 1,
            branchSteps: preview.branchSteps - 1,
          },
        });
      }
      // 分岐から本筋へ戻る
      return ok({
        ...state,
        activeBranch: null,
        preview: {
          tesuu: activeBranch.startTesuu,
          branchIndex: 0,
          branchSteps: 0,
        },
      });
    }

    // 本筋で戻る
    return ok({
      ...state,
      preview: {
        tesuu: Math.max(0, preview.tesuu - 1),
        branchIndex: 0,
        branchSteps: 0,
      },
    });
  }

  static moveNext(
    state: NavigationState,
    viewBranches: Branch[],
    maxTesuu: number,
  ): BranchNavigationResult {
    const { preview, selectedBranchIndex, activeBranch } = state;

    // 分岐内：分岐手順を進める
    if (preview.branchIndex > 0 && activeBranch) {
      if (preview.branchSteps < activeBranch.length - 1) {
        return ok({
          ...state,
          preview: {
            ...preview,
            tesuu: preview.tesuu + 1,
            branchSteps: preview.branchSteps + 1,
          },
        });
      }
      return fail("分岐の終端です");
    }

    // 分岐へ入る（本筋/分岐問わず）
    if (selectedBranchIndex > 0) {
      const br = viewBranches[selectedBranchIndex - 1];
      if (!br) return fail("選択された分岐が見つかりません");
      return ok({
        ...state,
        selectedBranchIndex: 0,
        preview: {
          tesuu: br.startTesuu + 1,
          branchIndex: selectedBranchIndex,
          branchSteps: 0,
        },
        activeBranch: br,
      });
    }

    // 本筋で進む
    return ok({
      ...state,
      preview: {
        tesuu: Math.min(maxTesuu, preview.tesuu + 1),
        branchIndex: 0,
        branchSteps: 0,
      },
    });
  }

  static selectBranch(
    state: NavigationState,
    direction: "up" | "down",
    count: number,
  ): BranchNavigationResult {
    const cur = state.selectedBranchIndex;
    const next =
      direction === "down" ? Math.min(count, cur + 1) : Math.max(0, cur - 1);
    return ok({ ...state, selectedBranchIndex: next });
  }

  static confirmNavigation(
    state: NavigationState,
    viewBranches: Branch[],
    jkf: JKFPlayer,
  ): BranchNavigationResult {
    try {
      const { preview, activeBranch } = state;

      if (preview.branchIndex === 0) {
        // 本筋
        jkf.goto(preview.tesuu);
      } else {
        const br = activeBranch || viewBranches[preview.branchIndex - 1];
        if (!br) throw new Error("activeBranch not found");

        jkf.goto(br.startTesuu);
        jkf.forkAndForward(br.forkPointers.forkIndex);

        for (let i = 0; i < preview.branchSteps; i++) {
          if (!jkf.forward()) break;
        }
      }

      const t = jkf.tesuu;
      return ok({
        currentTesuu: t,
        selectedBranchIndex: 0,
        preview: { tesuu: t, branchIndex: 0, branchSteps: 0 },
        activeBranch: null,
      });
    } catch (e) {
      return fail(String(e));
    }
  }
}

function ok(newState: NavigationState): BranchNavigationResult {
  return { success: true, newState };
}
function fail(error: string): BranchNavigationResult {
  return { success: false, error };
}
