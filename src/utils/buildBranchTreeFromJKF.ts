import { createPositionNode, type JKFData, type PositionNode } from "@/types";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

type JKFMoveNode = {
  move?: IMoveMoveFormat;
  forks?: Array<{ moves: JKFMoveNode[] }>;
};

function normalizeForkMoves(next?: JKFMoveNode): JKFMoveNode[][] {
  const fks = next?.forks ?? [];
  return fks
    .map((fk: any) => (Array.isArray(fk) ? fk : (fk?.moves ?? [])))
    .filter((arr: any) => Array.isArray(arr) && arr.length > 0);
}

export function buildBranchTreeFromJKF(kifu: JKFData) {
  const nodes = new Map<string, PositionNode>();

  // rootを用意
  const rootId = "root";
  nodes.set(rootId, {
    id: rootId,
    move: undefined,
    parentId: null,
    childrenIds: [],
    tesuu: 0,
    isMainLine: true,
    comment: "初期局面",
  });

  const addChild = (
    parentId: string,
    move: IMoveMoveFormat,
    tesuu: number,
    isMainLine: boolean,
  ) => {
    const node = createPositionNode(move, parentId, tesuu, isMainLine);
    nodes.set(node.id, node);
    const parent = nodes.get(parentId)!;
    nodes.set(parentId, {
      ...parent,
      childrenIds: [...parent.childrenIds, node.id],
    });
    return node.id;
  };

  const line = (kifu.moves as unknown as JKFMoveNode[]) ?? [];

  const expand = (
    line: JKFMoveNode[],
    pos: number,
    parentId: string,
    tesuu: number,
  ) => {
    // 本線の次の手
    const next = line[pos + 1];

    if (next?.move) {
      const childId = addChild(parentId, next.move, tesuu + 1, true);
      expand(line, pos + 1, childId, tesuu + 1);
    }

    // 分岐 (この位置のalternatives)
    const forkLines = normalizeForkMoves(next);
    for (const forkLine of forkLines) {
      const first = forkLine[0];
      if (!first?.move) continue;
      const childId = addChild(parentId, first.move, tesuu + 1, false);
      // フォーク側はposition=0から再帰開始
      expand(forkLine, 0, childId, tesuu + 1);
    }
  };

  expand(line, 0, rootId, 0);

  return { nodes, rootNodeId: rootId };
}
