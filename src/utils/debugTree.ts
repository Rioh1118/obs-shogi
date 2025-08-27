import type { PositionNode } from "@/types/branch";
import { formatMove } from "@/utils/shogi-format";

/**
 * ノードツリーの構造を詳細にコンソール出力
 */
export function logDetailedTreeStructure(
  nodes: Map<string, PositionNode>,
  rootNodeId: string,
  currentNodeId: string,
  options: {
    maxDepth?: number;
    showFullNodeIds?: boolean;
    showMoveDetails?: boolean;
  } = {},
) {
  const {
    maxDepth = 10,
    showFullNodeIds = false,
    showMoveDetails = true,
  } = options;

  console.group("🌳 ノードツリー構造詳細");
  console.log(`📊 総ノード数: ${nodes.size}`);
  console.log(`🏠 ルートノード: ${rootNodeId}`);
  console.log(`📍 現在ノード: ${currentNodeId}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // ツリーを再帰的に出力
  const visited = new Set<string>();

  function logNode(
    nodeId: string,
    depth: number,
    prefix: string = "",
    isLast: boolean = true,
  ) {
    if (depth > maxDepth || visited.has(nodeId)) {
      if (depth > maxDepth) {
        console.log(`${prefix}⋯ (深度制限 ${maxDepth} 到達)`);
      }
      return;
    }

    visited.add(nodeId);
    const node = nodes.get(nodeId);

    if (!node) {
      console.log(`${prefix}❌ ノード未発見: ${nodeId}`);
      return;
    }

    // ノード表示
    const connector = isLast ? "└─ " : "├─ ";
    const nodeIdDisplay = showFullNodeIds ? nodeId : nodeId.slice(-6);
    const currentMarker = nodeId === currentNodeId ? " 👉" : "";
    const mainLineMarker = node.isMainLine ? " 🏠" : "";

    let nodeInfo = `${connector}[${nodeIdDisplay}] ${node.tesuu}手目${mainLineMarker}${currentMarker}`;

    if (showMoveDetails && node.move) {
      const moveStr = formatMove(node.move);
      nodeInfo += ` | 手: ${moveStr}`;
    }

    if (node.comment) {
      nodeInfo += ` | コメント: ${node.comment}`;
    }

    console.log(`${prefix}${nodeInfo}`);

    // メタ情報
    if (node.parentId || node.childrenIds.length > 0) {
      const nextPrefix = prefix + (isLast ? "    " : "│   ");
      console.log(`${nextPrefix}├─ 親: ${node.parentId || "なし"}`);
      console.log(
        `${nextPrefix}└─ 子: [${node.childrenIds.length}] ${node.childrenIds.map((id) => id.slice(-6)).join(", ")}`,
      );
    }

    // 子ノードを再帰的に出力
    const children = node.childrenIds;
    if (children.length > 0) {
      const nextPrefix = prefix + (isLast ? "    " : "│   ");

      children.forEach((childId, index) => {
        const isLastChild = index === children.length - 1;
        logNode(childId, depth + 1, nextPrefix, isLastChild);
      });
    }
  }

  logNode(rootNodeId, 0);

  // 統計情報
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📈 統計情報:");

  const stats = {
    totalNodes: nodes.size,
    mainLineNodes: 0,
    branchNodes: 0,
    maxTesuu: 0,
    nodesWithComments: 0,
    leavesNodes: 0,
  };

  for (const node of nodes.values()) {
    if (node.isMainLine) stats.mainLineNodes++;
    else stats.branchNodes++;

    if (node.tesuu > stats.maxTesuu) stats.maxTesuu = node.tesuu;

    if (node.comment) stats.nodesWithComments++;

    if (node.childrenIds.length === 0) stats.leavesNodes++;
  }

  console.table(stats);

  // 現在パスの詳細
  console.log("🛤️ 現在位置までのパス:");
  const pathToCurrentNode: PositionNode[] = [];
  let current = nodes.get(currentNodeId);

  while (current) {
    pathToCurrentNode.unshift(current);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }

  pathToCurrentNode.forEach((node, index) => {
    const arrow = index === 0 ? "🏁" : "→";
    const moveStr = node.move ? formatMove(node.move) : "初期局面";
    console.log(`  ${arrow} ${index}手目: ${moveStr} [${node.id.slice(-6)}]`);
  });

  console.groupEnd();
}

/**
 * 簡潔版: ノードツリーのサマリーを出力
 */
export function logTreeSummary(
  nodes: Map<string, PositionNode>,
  rootNodeId: string,
  currentNodeId: string,
) {
  console.log("🌳 ツリーサマリー:", {
    totalNodes: nodes.size,
    rootId: rootNodeId.slice(-6),
    currentId: currentNodeId.slice(-6),
    currentTesuu: nodes.get(currentNodeId)?.tesuu || 0,
    maxTesuu: Math.max(...Array.from(nodes.values()).map((n) => n.tesuu)),
    branchesCount: Array.from(nodes.values()).filter((n) => !n.isMainLine)
      .length,
  });
}

/**
 * 問題ノードを検出
 */
export function detectTreeProblems(
  nodes: Map<string, PositionNode>,
  rootNodeId: string,
): string[] {
  const problems: string[] = [];

  // 1. 孤立ノード検出
  const reachableNodes = new Set<string>();
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachableNodes.has(nodeId)) continue;

    reachableNodes.add(nodeId);
    const node = nodes.get(nodeId);
    if (node) {
      queue.push(...node.childrenIds);
    }
  }

  const unreachableNodes = Array.from(nodes.keys()).filter(
    (id) => !reachableNodes.has(id),
  );
  if (unreachableNodes.length > 0) {
    problems.push(`🚨 孤立ノード発見: ${unreachableNodes.length}個`);
  }

  // 2. 循環参照検出
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visiting.add(nodeId);
    const node = nodes.get(nodeId);

    if (node) {
      for (const childId of node.childrenIds) {
        if (hasCycle(childId)) return true;
      }
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }

  if (hasCycle(rootNodeId)) {
    problems.push("🚨 循環参照が検出されました");
  }

  // 3. 親子関係の整合性チェック
  for (const [nodeId, node] of nodes) {
    // 親ノードが存在し、その子リストに自分が含まれているか
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (!parent) {
        problems.push(`🚨 存在しない親参照: ${nodeId} → ${node.parentId}`);
      } else if (!parent.childrenIds.includes(nodeId)) {
        problems.push(
          `🚨 親子関係不整合: 親 ${node.parentId} が子 ${nodeId} を参照していない`,
        );
      }
    }

    // 子ノードが存在し、その親が自分になっているか
    for (const childId of node.childrenIds) {
      const child = nodes.get(childId);
      if (!child) {
        problems.push(`🚨 存在しない子参照: ${nodeId} → ${childId}`);
      } else if (child.parentId !== nodeId) {
        problems.push(
          `🚨 親子関係不整合: 子 ${childId} の親が ${nodeId} でない`,
        );
      }
    }
  }

  if (problems.length === 0) {
    problems.push("✅ ツリー構造に問題は見つかりませんでした");
  }

  return problems;
}
