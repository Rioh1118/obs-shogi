// utils/findCurrentNodeId.ts
import { JKFPlayer } from "json-kifu-format";
import { isSameMove } from "@/utils/shogi-format";
import type { PositionNode } from "@/types/branch";

export function findNodeIdForCurrentJKF(
  nodes: Map<string, PositionNode>,
  rootNodeId: string,
  jkf: JKFPlayer,
): string {
  try {
    const replay = new JKFPlayer(jkf.kifu);
    // 現在の fork 経路を復元
    const forks = jkf.getForkPointers();
    replay.goto(0, forks);

    let nodeId = rootNodeId;
    for (let i = 0; i < jkf.tesuu; i++) {
      replay.forward();
      const m = replay.getMove();
      if (!m) break;
      const parent = nodes.get(nodeId);
      if (!parent) break;
      const child = parent.childrenIds
        .map((id) => nodes.get(id)!)
        .find((n) => n.move && isSameMove(n.move, m));
      if (!child) break;
      nodeId = child.id;
    }
    return nodeId;
  } catch {
    return rootNodeId;
  }
}
