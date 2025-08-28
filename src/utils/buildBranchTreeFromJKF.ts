import { createPositionNode, type JKFData, type PositionNode } from "@/types";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { isSameMove } from "./shogi-format";

type JKFMoveNode = {
  move?: IMoveMoveFormat;
  forks?: Array<{ moves: JKFMoveNode[] }>;
  comments?: string[];
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

  const appendChildId = (
    parent: PositionNode,
    childId: string,
    main: boolean,
  ) => {
    if (main) {
      // 本譜は先頭
      if (parent.childrenIds[0] !== childId) {
        nodes.set(parent.id, {
          ...parent,
          childrenIds: [
            childId,
            ...parent.childrenIds.filter((id) => id !== childId),
          ],
        });
      }
    } else {
      if (!parent.childrenIds.includes(childId)) {
        nodes.set(parent.id, {
          ...parent,
          childrenIds: [...parent.childrenIds, childId],
        });
      }
    }
  };

  const findExistingChild = (
    parentId: string,
    mv: IMoveMoveFormat,
  ): string | null => {
    const p = nodes.get(parentId);
    if (!p) return null;

    for (const cid of p.childrenIds) {
      const c = nodes.get(cid);
      if (c?.move && isSameMove(c.move, mv)) return cid;
    }

    return null;
  };

  const addOrReuseChild = (
    parentId: string,
    mv: IMoveMoveFormat,
    tesuu: number,
    isMainLine: boolean,
    comment?: string,
  ): string => {
    const parent = nodes.get(parentId)!;

    // 既存の同一手があれば流用
    const existingId = findExistingChild(parentId, mv);
    if (existingId) {
      const existing = nodes.get(existingId)!;
      // 本譜側で来たら本譜フラグを立て直し&先頭に移動
      if (isMainLine && !existing.isMainLine) {
        nodes.set(existingId, { ...existing, isMainLine: true });
      } else {
        appendChildId(parent, existingId, existing?.isMainLine);
      }
      // コメントの取り込み
      if (comment && !existing.comment) {
        nodes.set(existingId, { ...existing, comment });
      }

      return existingId;
    }

    const node = createPositionNode(mv, parentId, tesuu, isMainLine);
    if (comment) node.comment = comment;
    nodes.set(node.id, node);
    appendChildId(parent, node.id, isMainLine);
    return node.id;
  };

  const line = (kifu.moves as unknown as JKFMoveNode[]) ?? [];

  const expand = (
    line: JKFMoveNode[],
    pos: number,
    parentId: string,
    tesuu: number,
  ) => {
    const next = line[pos + 1];
    if (!next) return;

    // 1) 本譜
    let mainChildId: string | null = null;
    if (next.move) {
      const cmt =
        Array.isArray(next.comments) && next.comments.length > 0
          ? next.comments[0]
          : undefined;
      mainChildId = addOrReuseChild(parentId, next.move, tesuu + 1, true, cmt);
      expand(line, pos + 1, mainChildId, tesuu + 1);
    }

    // 2) 変化
    const forkLines = normalizeForkMoves(next);
    for (const forkLine of forkLines) {
      const first = forkLine[0];
      if (!first?.move) continue;

      // 本譜と同一手ならスキップ
      if (next.move && isSameMove(next.move, first.move)) {
        continue;
      }

      const cmt =
        Array.isArray(first.comments) && first.comments.length > 0
          ? first.comments[0]
          : undefined;
      const varChildId = addOrReuseChild(
        parentId,
        first.move,
        tesuu + 1,
        false,
        cmt,
      );
      // フォーク側はフォーク配列を０からたどる
      expand(forkLine, 0, varChildId, tesuu + 1);
    }
  };

  expand(line, 0, rootId, 0);

  return { nodes, rootNodeId: rootId };
}
