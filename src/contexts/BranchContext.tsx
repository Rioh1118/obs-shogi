import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
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

function branchReducer(
  state: BranchContextState,
  action: BranchAction,
): BranchContextState {
  switch (action.type) {
    case "set_branch_path":
      return {
        ...state,
        currentBranchPath: action.payload,
      };

    case "update_available_branches":
      return {
        ...state,
        availableBranches: action.payload,
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
    // パフォーマンス問題のため一時的に無効化
    dispatch({ type: "update_available_branches", payload: [] });
    return;

    // if (!gameState.jkfPlayer) {
    //   dispatch({ type: "update_available_branches", payload: [] });
    //   return;
    // }

    // try {
    //   const jkfPlayer = gameState.jkfPlayer;
    //   const branches: BranchInfo[] = [];

    //   // 現在のフォーク構造から効率的に分岐を取得
    //   const forks = jkfPlayer.forks;

    //   forks.forEach((fork) => {
    //     if (fork.te >= 0 && fork.moves.length > 1) {
    //       // 分岐が存在する場合（メイン線以外の手）
    //       fork.moves.slice(1).forEach((move, moveIndex) => {
    //         if (move.move) {
    //           const branchInfo: BranchInfo = {
    //             id: `${fork.te}-${moveIndex}`,
    //             startTesuu: fork.te,
    //             forkPointers: [{ te: fork.te + 1, forkIndex: moveIndex }],
    //             firstMove: move.move,
    //             depth: 1,
    //             length: 1,
    //           };
    //           branches.push(branchInfo);
    //         }
    //       });
    //     }
    //   });

    //   dispatch({ type: "update_available_branches", payload: branches });
    // } catch (error) {
    //   dispatch({
    //     type: "set_error",
    //     payload:
    //       error instanceof Error
    //         ? error.message
    //         : "分岐情報の更新に失敗しました",
    //   });
    // }
  }, []);

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
          const forkPointer = forkPointers[0];
          // 分岐の開始手数に移動
          gameState.jkfPlayer.goto(forkPointer.te - 1);
          // 分岐に進む
          gameState.jkfPlayer.forkAndForward(forkPointer.forkIndex);
        }

        dispatch({ type: "set_branch_path", payload: forkPointers });
      } catch (error) {
        dispatch({
          type: "set_error",
          payload:
            error instanceof Error
              ? error.message
              : "分岐の切り替えに失敗しました",
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
        const result = gameState.jkfPlayer.inputMove(move);

        if (result) {
          // 分岐情報を更新
          updateAvailableBranches();

          // 現在の分岐パスを更新
          const currentForkPointers = gameState.jkfPlayer.getForkPointers();
          dispatch({ type: "set_branch_path", payload: currentForkPointers });
        }

        return result;
      } catch (error) {
        dispatch({
          type: "set_error",
          payload:
            error instanceof Error ? error.message : "分岐の作成に失敗しました",
        });
        return false;
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [gameState.jkfPlayer, updateAvailableBranches],
  );

  // 現在の分岐パスを取得
  const getCurrentBranchPath = useCallback((): ForkPointer[] => {
    if (!gameState.jkfPlayer) return [];
    return gameState.jkfPlayer.getForkPointers();
  }, [gameState.jkfPlayer]);

  // 指定手数での利用可能な分岐を取得
  const getAvailableBranchesAtTesuu = useCallback(
    (tesuu: number): BranchInfo[] => {
      return state.availableBranches.filter(
        (branch) => branch.startTesuu === tesuu,
      );
    },
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

  // GameContextの変更を監視して分岐情報を更新（初回のみ）
  // useMemo(() => {
  //   if (gameState.jkfPlayer) {
  //     updateAvailableBranches();
  //   }
  // }, [gameState.jkfPlayer]);

  const contextValue: BranchContextType = {
    state,
    switchToBranch,
    createBranchFromMove,
    getCurrentBranchPath,
    getAvailableBranchesAtTesuu,
    hasAvailableBranches,
    clearError,
  };

  return (
    <BranchContext.Provider value={contextValue}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error("useBranch must be used within a BranchProvider");
  }
  return context;
}
