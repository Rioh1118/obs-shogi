import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
  useMemo,
} from "react";
import type { BranchContextType, PositionNode } from "@/types/branch";
import { formatMove, isSameMove } from "@/utils/shogi-format";
import { useGame } from "./GameContext";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { buildBranchTreeFromJKF } from "@/utils/buildBranchTreeFromJKF";
import { findNodeIdForCurrentJKF } from "@/utils/findCurrentNodeId";

const BranchContext = createContext<BranchContextType | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { state: gameState } = useGame();

  const branchData = useMemo(() => {
    if (!gameState.jkfPlayer) {
      return {
        nodes: new Map<string, PositionNode>(),
        rootNodeId: "root",
        currentNodeId: "root",
        pathFromRoot: ["root"] as string[],
        availableMovesFromCurrent: [] as Array<{
          nodeId: string;
          move: IMoveMoveFormat;
          isMainLine: boolean;
          preview: string;
        }>,
      };
    }

    // ツリー構築
    console.log(gameState.jkfPlayer.kifu);
    const { nodes, rootNodeId } = buildBranchTreeFromJKF(
      gameState.jkfPlayer.kifu,
    );
    console.log(nodes);

    // 現在位置計算
    const currentNodeId = findNodeIdForCurrentJKF(
      nodes,
      rootNodeId,
      gameState.jkfPlayer,
    );
    console.log(currentNodeId);

    // パス計算
    const pathFromRoot: string[] = [];
    let current = nodes.get(currentNodeId);
    while (current) {
      pathFromRoot.unshift(current.id);
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }

    // 利用可能手計算
    const currentNode = nodes.get(currentNodeId);
    const availableMovesFromCurrent = currentNode
      ? currentNode.childrenIds
          .map((id) => nodes.get(id))
          .filter((n): n is PositionNode => !!n && !!n.move)
          .map((n) => ({
            nodeId: n.id,
            move: n.move!,
            isMainLine: n.isMainLine,
            preview: formatMove(n.move!),
          }))
      : [];

    return {
      nodes,
      rootNodeId,
      currentNodeId,
      pathFromRoot,
      availableMovesFromCurrent,
    };
  }, [gameState?.jkfPlayer?.kifu, gameState?.jkfPlayer]);

  // JKFPlayerと内部ノード構造を同期
  const syncWithJKFPlayerToNode = useCallback(
    (nodeId: string) => {
      if (!gameState.jkfPlayer || !branchData.nodes.has(nodeId)) return;

      const pathToNode: PositionNode[] = [];
      let current = branchData.nodes.get(nodeId);

      // ルートまでのパスを構築
      while (current) {
        pathToNode.unshift(current);
        current = current.parentId
          ? branchData.nodes.get(current.parentId)
          : undefined;
      }

      // JKFPlayerを初期局面に戻す
      gameState.jkfPlayer.goto(0);

      // パスに沿って移動
      pathToNode.forEach((node, index) => {
        if (index === 0) return; // ルートをスキップ
        const parent = branchData.nodes.get(node.parentId!);
        if (!parent) return;

        const childIndex = parent.childrenIds.indexOf(node.id);
        if (childIndex === 0) {
          // 本線
          gameState?.jkfPlayer?.forward();
        } else if (childIndex > 0) {
          // 分岐
          gameState.jkfPlayer?.forkAndForward(childIndex - 1);
        }
      });
    },
    [gameState.jkfPlayer, branchData.nodes],
  );

  // ノードへ移動
  const goToNode = useCallback(
    (nodeId: string) => {
      syncWithJKFPlayerToNode(nodeId);
    },
    [syncWithJKFPlayerToNode],
  );

  // 新しい分岐を作成
  const createNewBranch = useCallback(
    async (move: IMoveMoveFormat): Promise<string> => {
      if (!gameState.jkfPlayer) return "";

      const currentNode = branchData.nodes.get(branchData.currentNodeId);
      if (!currentNode) return "";

      // 既存チェック
      const existingChild = currentNode.childrenIds
        .map((id) => branchData.nodes.get(id))
        .find((node) => node?.move && isSameMove(node.move, move));

      if (existingChild) {
        goToNode(existingChild.id);
        return existingChild.id;
      }

      // 新規作成
      gameState.jkfPlayer.inputMove(move);
      const newCurrentNodeId = findNodeIdForCurrentJKF(
        buildBranchTreeFromJKF(gameState.jkfPlayer.kifu).nodes,
        branchData.rootNodeId,
        gameState.jkfPlayer,
      );
      return newCurrentNodeId;
    },
    [gameState.jkfPlayer, branchData, goToNode],
  );

  const getNode = useCallback(
    (nodeId: string): PositionNode | null => {
      return branchData.nodes.get(nodeId) || null;
    },
    [branchData.nodes],
  );

  const getCurrentNode = useCallback((): PositionNode | null => {
    return branchData.nodes.get(branchData.currentNodeId) || null;
  }, [branchData.nodes, branchData.currentNodeId]);

  const getChildrenNodes = useCallback(
    (nodeId: string): PositionNode[] => {
      const node = branchData.nodes.get(nodeId);
      if (!node) return [];

      return node.childrenIds
        .map((id) => branchData.nodes.get(id))
        .filter((n): n is PositionNode => n !== undefined);
    },
    [branchData.nodes],
  );

  // 指定ノードへのパスを取得
  const getPathToNode = useCallback(
    (nodeId: string): string[] => {
      const path: string[] = [];
      let current = branchData.nodes.get(nodeId);

      while (current) {
        path.unshift(current.id);
        current = current.parentId
          ? branchData.nodes.get(current.parentId)
          : undefined;
      }

      return path;
    },
    [branchData.nodes],
  );

  const state = useMemo(
    () => ({
      nodes: branchData.nodes,
      rootNodeId: branchData.rootNodeId,
      currentPosition: {
        nodeId: branchData.currentNodeId,
        pathFromRoot: branchData.pathFromRoot,
      },
      availableMovesFromCurrent: branchData.availableMovesFromCurrent,
      isLoading: false,
      error: null,
    }),
    [branchData],
  );

  const value = useMemo<BranchContextType>(
    () => ({
      state,
      goToNode,
      createNewBranch,
      getCurrentNode,
      getChildrenNodes,
      getNode,
      getPathToNode,
      // その他必要なメソッドを追加...
    }),
    [
      state,
      goToNode,
      createNewBranch,
      getCurrentNode,
      getChildrenNodes,
      getNode,
      getPathToNode,
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
