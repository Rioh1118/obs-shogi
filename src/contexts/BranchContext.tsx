import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
  useMemo,
} from "react";
import type {
  BranchContextState,
  BranchAction,
  BranchContextType,
  BranchInfo,
  ForkPointer,
} from "@/types/branch";
import { initialBranchState } from "@/types/branch";
import { useGame } from "./GameContext";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { applyMoveWithBranch } from "@/services/game/applyMoveWithBranchAware";

function branchReducer(
  state: BranchContextState,
  action: BranchAction,
): BranchContextState {
  switch (action.type) {
    case "set_available_branches":
      return {
        ...state,
        availableBranches: action.payload,
      };

    case "set_current_branch_path":
      return {
        ...state,
        currentBranchPath: action.payload,
      };

    case "set_loading":
      return {
        ...state,
        isLoading: action.payload,
      };

    case "set_error":
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };

    case "clear_error":
      return {
        ...state,
        error: null,
      };

    case "reset_state":
      return initialBranchState;

    default:
      return state;
  }
}

const BranchContext = createContext<BranchContextType | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(branchReducer, initialBranchState);
  const { state: gameState } = useGame();

  // 利用可能な分岐情報を更新（軽量版）
  const updateAvailableBranches = useCallback(() => {
    if (!gameState.jkfPlayer) {
      dispatch({ type: "set_available_branches", payload: [] });
      return;
    }

    try {
      const forks = gameState.jkfPlayer.forks;
      const branches: BranchInfo[] = [];
      forks.forEach((fork) => {
        if (fork.te >= 0 && fork.moves.length > 1) {
          fork.moves.slice(1).forEach((mv, idx) => {
            if (mv.move) {
              const pointer: ForkPointer = {
                te: fork.te + 1,
                forkIndex: idx,
              };
              branches.push({
                id: `${fork.te}-${idx}`,
                startTesuu: fork.te,
                forkPointers: [pointer],
                firstMove: mv.move,
              });
            }
          });
        }
        dispatch({ type: "set_available_branches", payload: branches });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: "set_error", payload: message });
    }
  }, [gameState.jkfPlayer]);

  // 分岐に切り替え
  const switchToBranch = useCallback(
    async (forkPointers: ForkPointer[]) => {
      if (!gameState.jkfPlayer) {
        dispatch({
          type: "set_error",
          payload: "ゲームが読み込まれていません",
        });
        return;
      }

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });
        // JKFPlayerのforkAndForward機能を使用して分岐に移動
        if (forkPointers.length > 0) {
          const { te, forkIndex } = forkPointers[0];
          // 分岐の開始手数に移動
          gameState.jkfPlayer.goto(te - 1);
          // 分岐に進む
          gameState.jkfPlayer.forkAndForward(forkIndex);
        }

        dispatch({ type: "set_current_branch_path", payload: forkPointers });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({
          type: "set_error",
          payload: message,
        });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [gameState.jkfPlayer],
  );

  // 新しい手から分岐を作成
  const createBranchFromMove = useCallback(
    async (move: IMoveMoveFormat): Promise<boolean> => {
      if (!gameState.jkfPlayer) {
        dispatch({
          type: "set_error",
          payload: "ゲームが読み込まれていません",
        });
        return false;
      }

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        // JKFPlayerのinputMove機能を使用
        // const result = gameState.jkfPlayer.inputMove(move);
        const { createdNew } = applyMoveWithBranch(gameState.jkfPlayer, move);
        const result = createdNew;

        if (result) {
          // 分岐情報を更新
          updateAvailableBranches();
          const newPath = gameState.jkfPlayer.getForkPointers();
          dispatch({
            type: "set_current_branch_path",
            payload: newPath,
          });
        }

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({
          type: "set_error",
          payload: message,
        });
        return false;
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [gameState.jkfPlayer, updateAvailableBranches],
  );

  // 現在の分岐パスを取得
  const getCurrentBranchPath = useCallback(
    (): ForkPointer[] =>
      gameState.jkfPlayer ? gameState.jkfPlayer.getForkPointers() : [],
    [gameState.jkfPlayer],
  );

  // 指定手数での利用可能な分岐を取得
  const getAvailableBranchesAtTesuu = useCallback(
    (tesuu: number): BranchInfo[] =>
      state.availableBranches.filter((b) => b.startTesuu === tesuu),
    [state.availableBranches],
  );

  // 指定手数で分岐があるかチェック
  const hasAvailableBranches = useCallback(
    (tesuu: number): boolean => {
      return getAvailableBranchesAtTesuu(tesuu).length > 0;
    },
    [getAvailableBranchesAtTesuu],
  );

  // エラーをクリア
  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const value = useMemo<BranchContextType>(
    () => ({
      state,
      updateAvailableBranches,
      switchToBranch,
      createBranchFromMove,
      getCurrentBranchPath,
      getAvailableBranchesAtTesuu,
      hasAvailableBranches,
      clearError,
    }),
    [
      state,
      updateAvailableBranches,
      switchToBranch,
      createBranchFromMove,
      getCurrentBranchPath,
      getAvailableBranchesAtTesuu,
      hasAvailableBranches,
      clearError,
    ],
  );

  return (
    <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
  );
}

export function useBranch(): BranchContextType {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error("useBranch must be used within a BranchProvider");
  }
  return context;
}
