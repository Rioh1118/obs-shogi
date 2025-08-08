import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
  useMemo,
} from "react";
import type { BranchContextType, PositionNode } from "@/types/branch";
import {
  initialBranchState,
  branchReducer,
  createPositionNode,
} from "@/types/branch";
import { formatMove, isSameMove } from "@/utils/shogi-format";
import { useGame } from "./GameContext";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

const BranchContext = createContext<BranchContextType | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(branchReducer, initialBranchState);
  const { state: gameState } = useGame();

  // JKFPlayerと内部ノード構造を同期
  const syncWithJKFPlayer = useCallback(
    (nodeId: string) => {
      if (!gameState.jkfPlayer || !state.nodes.has(nodeId)) return;

      const pathToNode: PositionNode[] = [];
      let current = state.nodes.get(nodeId);

      // ルートまでのパスを構築
      while (current) {
        pathToNode.unshift(current);
        current = current.parentId
          ? state.nodes.get(current.parentId)
          : undefined;
      }

      // JKFPlayerを初期局面に戻す
      gameState.jkfPlayer.goto(0);

      // パスに沿って移動
      pathToNode.forEach((node, index) => {
        if (index === 0) return; // ルートをスキップ
        const parent = state.nodes.get(node.parentId!);
        if (!parent) return;

        const childIndex = parent.childrenIds.indexOf(node.id);

        if (childIndex === 0 && parent.childrenIds.length > 0) {
          // 本線(最初の子)
          gameState.jkfPlayer.forward();
        } else if (childIndex > 0) {
          // 分岐
          gameState.jkfPlayer?.forkAndForward(childIndex - 1);
        }
      });
    },
    [gameState.jkfPlayer, state.nodes],
  );

  // ノードへ移動
  const goToNode = useCallback(
    (nodeId: string) => {
      dispatch({ type: "move_to_node", payload: nodeId });
      syncWithJKFPlayer(nodeId);
    },
    [syncWithJKFPlayer],
  );

  const getNode = useCallback(
    (nodeId: string): PositionNode | null => {
      return state.nodes.get(nodeId) || null;
    },
    [state.nodes],
  );

  // 手数から位置へ移動
  const goToPositionAtTesuu = useCallback(
    (tesuu: number, preferMainLine: boolean = true) => {
      if (preferMainLine) {
        // 本線をたどって指定手数のノードを探す
        let current = state.nodes.get(state.rootNodeId);

        while (current && current.tesuu < tesuu) {
          // 本線の子を探す
          const mainChild = current.childrenIds
            .map((id) => state.nodes.get(id))
            .find((node) => node?.isMainLine);

          if (!mainChild) break;
          current = mainChild;
        }

        if (current && current.tesuu === tesuu) {
          goToNode(current.id);
        }
      } else {
        // 現在のパスで指定手数のノードを探す
        const targetNode = state.currentPosition.pathFromRoot
          .map((id) => state.nodes.get(id))
          .find((node) => node?.tesuu === tesuu);

        if (targetNode) {
          goToNode(targetNode.id);
        }
      }
    },
    [
      state.nodes,
      state.rootNodeId,
      state.currentPosition.pathFromRoot,
      goToNode,
    ],
  );

  // 次の手へ
  const nextMove = useCallback(() => {
    const currentNode = state.nodes.get(state.currentPosition.nodeId);
    if (!currentNode || currentNode.childrenIds.length === 0) return;

    // 最初の子(本線)へ移動
    const nextNodeId = currentNode.childrenIds[0];
    goToNode(nextNodeId);
  }, [state.nodes, state.currentPosition.nodeId, goToNode]);

  // 前の手へ
  const previousMove = useCallback(() => {
    const currentNode = state.nodes.get(state.currentPosition.nodeId);
    if (!currentNode || !currentNode.parentId) return;

    goToNode(currentNode.parentId);
  }, [state.nodes, state.currentPosition.nodeId, goToNode]);

  // 分岐を選択
  const selectBranch = useCallback(
    (childNodeId: string) => {
      const childNode = state.nodes.get(childNodeId);
      if (!childNode) return;

      // 現在のノードの子であることを確認
      const currentNode = state.nodes.get(state.currentPosition.nodeId);
      if (!currentNode || !currentNode.childrenIds.includes(childNodeId)) {
        return;
      }

      goToNode(childNodeId);
    },
    [state.nodes, state.currentPosition.nodeId, goToNode],
  );

  // 現在のノードから利用可能な手を更新
  const updateAvailableMovesFromCurrent = useCallback(() => {
    const currentNode = state.nodes.get(state.currentPosition.nodeId);
    if (!currentNode) {
      dispatch({ type: "set_available_moves", payload: [] });
      return;
    }

    const moves = currentNode.childrenIds
      .map((id) => state.nodes.get(id))
      .filter((node): node is PositionNode => node !== undefined)
      .map((node) => ({
        nodeId: node.id,
        move: node.move!,
        isMainLine: node.isMainLine,
        preview: formatMove(node.move), // TODO: formatMove 手を文字列化する関数
      }));

    dispatch({ type: "set_available_moves", payload: moves });
  }, [state.nodes, state.currentPosition.nodeId]);

  // 新しい分岐を作成
  const createNewBranch = useCallback(
    async (move: IMoveMoveFormat): Promise<string> => {
      if (!gameState.jkfPlayer) {
        dispatch({
          type: "set_error",
          payload: "ゲームが読み込まれていません",
        });
        return "";
      }
      try {
        dispatch({ type: "set_loading", payload: true });

        const currentNode = state.nodes.get(state.currentPosition.nodeId);
        if (!currentNode) {
          throw new Error("現在のノードが見つかりません");
        }

        // 既存の手と同じかチェック
        const existingChild = currentNode.childrenIds
          .map((id) => state.nodes.get(id))
          .find((node) => {
            return node?.move && isSameMove(node.move, move);
          });

        if (existingChild) {
          // 既存の手がある場合はそこへ移動
          goToNode(existingChild.id);
          return existingChild.id;
        }

        // 新しいノードを作成
        const isMainLine = currentNode.childrenIds.length === 0;
        const newNode = createPositionNode(
          move,
          currentNode.id,
          currentNode.tesuu + 1,
          isMainLine,
        );

        // ノードを追加
        dispatch({ type: "add_node", payload: newNode });
        dispatch({
          type: "add_child_to_node",
          payload: {
            parentId: currentNode.id,
            childId: newNode.id,
          },
        });

        // JKFPlayerに手を入力
        gameState.jkfPlayer.inputMove(move);

        // 新しいノードへ移動
        goToNode(newNode.id);

        // 利用可能な手を更新
        updateAvailableMovesFromCurrent();

        return newNode.id;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: "set_error", payload: message });
        return "";
      } finally {
        dispatch({
          type: "set_loading",
          payload: false,
        });
      }
    },
    [
      gameState.jkfPlayer,
      state.nodes,
      state.currentPosition.nodeId,
      goToNode,
      updateAvailableMovesFromCurrent,
    ],
  );

  const getCurrentNode = useCallback((): PositionNode | null => {
    return state.nodes.get(state.currentPosition.nodeId) || null;
  }, [state.nodes, state.currentPosition.nodeId]);

  const getChildrenNodes = useCallback(
    (nodeId: string): PositionNode[] => {
      const node = state.nodes.get(nodeId);
      if (!node) return [];

      return node.childrenIds
        .map((id) => state.nodes.get(id))
        .filter((n): n is PositionNode => n !== undefined);
    },
    [state.nodes],
  );

  // 現在の位置から利用可能な手を取得
  const getAvailableMovesFromCurrent = useCallback(() => {
    return state.availableMovesFromCurrent.map(({ nodeId, move }) => ({
      nodeId,
      move,
    }));
  }, [state.availableMovesFromCurrent]);

  // 現在のパスを取得
  const getCurrentPath = useCallback((): PositionNode[] => {
    return state.currentPosition.pathFromRoot
      .map((id) => state.nodes.get(id))
      .filter((node): node is PositionNode => node !== undefined);
  }, [state.currentPosition.pathFromRoot, state.nodes]);

  // 指定ノードへのパスを取得
  const getPathToNode = useCallback(
    (nodeId: string): string[] => {
      const path: string[] = [];
      let current = state.nodes.get(nodeId);

      while (current) {
        path.unshift(current.id);
        current = current.parentId
          ? state.nodes.get(current.parentId)
          : undefined;
      }

      return path;
    },
    [state.nodes],
  );

  // あるノードが別のノードの祖先かチェック
  const isAncestor = useCallback(
    (nodeId: string, ofNodeId: string): boolean => {
      let current = state.nodes.get(ofNodeId);

      while (current) {
        if (current.id === nodeId) return true;
        current = current.parentId
          ? state.nodes.get(current.parentId)
          : undefined;
      }

      return false;
    },
    [state.nodes],
  );

  // エラーをクリア
  const clearError = useCallback(() => {
    dispatch({ type: "set_error", payload: null });
  }, []);

  const value = useMemo<BranchContextType>(
    () => ({
      state,
      goToNode,
      goToPositionAtTesuu,
      nextMove,
      previousMove,
      selectBranch,
      createNewBranch,
      getCurrentNode,
      getChildrenNodes,
      getAvailableMovesFromCurrent,
      getCurrentPath,
      getPathToNode,
      getNode,
      isAncestor,
      clearError,
    }),
    [
      state,
      goToNode,
      goToPositionAtTesuu,
      nextMove,
      previousMove,
      selectBranch,
      createNewBranch,
      getCurrentNode,
      getChildrenNodes,
      getAvailableMovesFromCurrent,
      getCurrentPath,
      getPathToNode,
      getNode,
      isAncestor,
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
