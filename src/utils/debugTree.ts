// utils/debugTree.ts
import type { PositionNode } from "@/types/branch";
import { formatMove } from "@/utils/shogi-format";

function moveLabel(n?: PositionNode) {
  return n?.move ? formatMove(n.move) : "(初期)";
}

export function logTreeSnapshot(
  nodes: Map<string, PositionNode>,
  rootNodeId: string,
  opts: { maxDepth?: number } = {},
) {
  const { maxDepth = 2 } = opts;
  const root = nodes.get(rootNodeId);
  if (!root) {
    console.warn("[BranchTree] root not found", { rootNodeId });
    return;
  }

  const lines: string[] = [];
  const q: Array<{ id: string; depth: number; prefix: string }> = [
    { id: root.id, depth: 0, prefix: "" },
  ];

  while (q.length) {
    const { id, depth, prefix } = q.shift()!;
    const node = nodes.get(id);
    if (!node) continue;

    const childObjs = node.childrenIds.map((cid) => nodes.get(cid)!);
    const childSummary = childObjs
      .map((c, i) => `${i}:${c.isMainLine ? "M" : "V"} ${moveLabel(c)}`)
      .join(" | ");

    lines.push(
      `${prefix}${node.id} d=${node.tesuu} children=${childObjs.length} :: ${childSummary}`,
    );

    if (depth < maxDepth) {
      childObjs.forEach((c) =>
        q.push({ id: c.id, depth: depth + 1, prefix: prefix + "  " }),
      );
    }
  }

  console.groupCollapsed(
    `[BranchTree] nodes=${nodes.size} root=${rootNodeId} depth<=${maxDepth}`,
  );
  lines.forEach((l) => console.log(l));
  console.groupEnd();
}
